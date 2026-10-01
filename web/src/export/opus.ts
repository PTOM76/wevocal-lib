import type { Clip } from '../types'
import { OggWriter, opusHead, opusTags } from './ogg'
import { OPUS_SAMPLE_RATE } from './formats'

/** 1回に渡すフレーム数（20ms） */
const FRAME = 960
/** 1ページにまとめるパケット数の目安（約1秒） */
const PACKETS_PER_PAGE = 50

/**
 * Opus（Ogg コンテナ）にエンコードする。ブラウザ標準の WebCodecs を使うので追加のライブラリは要らない。
 * `clip` は 48kHz・2ch 以下であること（`prepareClip` で揃える）。
 */
export async function encodeOpus(clip: Clip, kbps: number, onProgress?: (p: number) => void): Promise<Blob> {
  const channels = clip.channels.length
  const len = clip.channels[0].length
  const packets: { data: Uint8Array; duration: number }[] = []
  let preSkip = 312 // 既定値。エンコーダが遅延を知らせてきたらそれを使う
  let failure: unknown = null

  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      packets.push({ data, duration: Math.round(((chunk.duration ?? 20000) * OPUS_SAMPLE_RATE) / 1e6) })
      const desc = meta?.decoderConfig?.description
      // description は OpusHead そのもの。pre-skip だけ借りる
      if (desc && desc.byteLength >= 12) {
        const view = ArrayBuffer.isView(desc)
          ? new DataView(desc.buffer, desc.byteOffset, desc.byteLength)
          : new DataView(desc as ArrayBuffer)
        preSkip = view.getUint16(10, true)
      }
    },
    error: (e) => {
      failure = e
    },
  })
  encoder.configure({ codec: 'opus', sampleRate: OPUS_SAMPLE_RATE, numberOfChannels: channels, bitrate: kbps * 1000 })

  for (let i = 0; i < len; i += FRAME) {
    const n = Math.min(FRAME, len - i)
    // f32-planar: チャンネルごとに n サンプルずつ並べる
    const planar = new Float32Array(n * channels)
    clip.channels.forEach((c, ch) => planar.set(c.subarray(i, i + n), ch * n))
    encoder.encode(
      new AudioData({
        format: 'f32-planar',
        sampleRate: OPUS_SAMPLE_RATE,
        numberOfFrames: n,
        numberOfChannels: channels,
        timestamp: Math.round((i / OPUS_SAMPLE_RATE) * 1e6),
        data: planar,
      }),
    )
    if (i % (FRAME * 200) === 0) {
      onProgress?.(i / len)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  await encoder.flush()
  encoder.close()
  if (failure) throw failure

  const ogg = new OggWriter()
  ogg.addPage([opusHead(channels, OPUS_SAMPLE_RATE, preSkip)], 0n, 0x02)
  ogg.addPage([opusTags('WeVocalSynth (WebCodecs)')], 0n)
  // granule は「デコード後に捨てる pre-skip も含めた」累計サンプル数。最後のページは元の長さで終わらせる
  let granule = 0
  for (let p = 0; p < packets.length; p += PACKETS_PER_PAGE) {
    const group = packets.slice(p, p + PACKETS_PER_PAGE)
    granule += group.reduce((s, x) => s + x.duration, 0)
    const last = p + PACKETS_PER_PAGE >= packets.length
    const g = last ? preSkip + len : granule
    ogg.addPage(
      group.map((x) => x.data),
      BigInt(g),
      last ? 0x04 : 0,
    )
  }
  onProgress?.(1)
  return ogg.toBlob('audio/ogg')
}

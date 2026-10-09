import type { Clip } from '../types'
import { AAC_CODEC } from './formats'
import { AAC_FRAME, audioSpecificConfig, muxM4a } from './mp4'

/**
 * AAC（M4A）にエンコードする。WebCodecs を使うので、対応するブラウザ（主に Chromium 系）だけで使える。
 * `clip` は 44.1kHz か 48kHz、2ch 以下であること（`prepareClip` でそろえる）。
 */
export async function encodeAac(clip: Clip, kbps: number, onProgress?: (p: number) => void): Promise<Blob> {
  const channels = clip.channels.length
  const rate = clip.sampleRate
  const len = clip.channels[0].length
  const frames: Uint8Array[] = []
  let config: Uint8Array | null = null
  let failure: unknown = null

  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      frames.push(data)
      const d = meta?.decoderConfig?.description
      // description は AudioSpecificConfig
      if (d && !config) config = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice() : new Uint8Array(d as ArrayBuffer).slice()
    },
    error: (e) => {
      failure = e
    },
  })
  encoder.configure({ codec: AAC_CODEC, sampleRate: rate, numberOfChannels: channels, bitrate: kbps * 1000 })

  for (let i = 0; i < len; i += AAC_FRAME * 20) {
    const n = Math.min(AAC_FRAME * 20, len - i)
    const planar = new Float32Array(n * channels)
    clip.channels.forEach((c, ch) => planar.set(c.subarray(i, i + n), ch * n))
    encoder.encode(
      new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((i / rate) * 1e6), data: planar }),
    )
    if (i % (AAC_FRAME * 400) === 0) {
      onProgress?.(i / len)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  await encoder.flush()
  encoder.close()
  if (failure) throw failure
  onProgress?.(1)
  return muxM4a(frames, { rate, channels, samples: len, config: config ?? audioSpecificConfig(rate, channels), kbps })
}

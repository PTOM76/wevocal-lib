import type { Clip } from './types'

// AIFF / AIFF-C の読み込み。Chrome・Firefox の decodeAudioData は AIFF を読めないので自前で読む。
// 対応: 非圧縮の整数 PCM（8〜32bit。ビッグエンディアン、AIFF-C の sowt はリトルエンディアン）と、AIFF-C の 32/64bit 浮動小数

const id = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

/** AIFF / AIFF-C のファイルか（先頭が FORM で、種類が AIFF か AIFC） */
export function isAiff(data: ArrayBuffer): boolean {
  if (data.byteLength < 12) return false
  const b = new Uint8Array(data, 0, 12)
  return id(b, 0) === 'FORM' && (id(b, 8) === 'AIFF' || id(b, 8) === 'AIFC')
}

/** 80bit 拡張精度浮動小数（COMM のサンプルレート）を読む */
function readExtended(v: DataView, o: number): number {
  const exp = v.getUint16(o) & 0x7fff
  const hi = v.getUint32(o + 2)
  const lo = v.getUint32(o + 6)
  if (!exp && !hi && !lo) return 0
  return (hi * 2 ** 32 + lo) * 2 ** (exp - 16383 - 63)
}

/** AIFF / AIFF-C を読んで Clip にする。対応していない形式（圧縮など）ならエラー */
export function decodeAiff(data: ArrayBuffer): Clip {
  const v = new DataView(data)
  const b = new Uint8Array(data)
  const aifc = id(b, 8) === 'AIFC'
  let comm: { channels: number; frames: number; bits: number; rate: number; codec: string } | null = null
  let ssnd: { start: number; end: number } | null = null
  for (let o = 12; o + 8 <= b.length; ) {
    const type = id(b, o)
    const size = v.getUint32(o + 4)
    const body = o + 8
    if (type === 'COMM') {
      comm = {
        channels: v.getUint16(body),
        frames: v.getUint32(body + 2),
        bits: v.getUint16(body + 6),
        rate: readExtended(v, body + 8),
        // AIFF-C は圧縮の種類が続く（AIFF は常に非圧縮のビッグエンディアン）
        codec: aifc && size >= 22 ? id(b, body + 18) : 'NONE',
      }
    } else if (type === 'SSND') {
      // オフセット（データの前の余白）とブロックサイズの後ろが音声
      const offset = v.getUint32(body)
      ssnd = { start: body + 8 + offset, end: Math.min(b.length, body + size) }
    }
    // チャンクは偶数バイトにそろえてある
    o = body + size + (size & 1)
  }
  if (!comm || !ssnd) throw new Error('AIFF: COMM / SSND chunk not found')
  const { channels, bits, rate, codec } = comm
  const float = codec === 'fl32' || codec === 'FL32' ? 32 : codec === 'fl64' || codec === 'FL64' ? 64 : 0
  const little = codec === 'sowt'
  if (!float && codec !== 'NONE' && codec !== 'twos' && !little) throw new Error(`AIFF: unsupported compression "${codec}"`)
  const bytes = float ? float / 8 : Math.ceil(bits / 8)
  if (!channels || !bytes || bytes > 8) throw new Error('AIFF: invalid format')
  const frames = Math.min(comm.frames, Math.floor((ssnd.end - ssnd.start) / (bytes * channels)))
  const out = Array.from({ length: channels }, () => new Float32Array(frames))
  // 整数はビット数ぶんの幅で -1〜1 にする（下位の余りビットは 0 なので、バイト幅で読んでから割る）
  const scale = 1 / 2 ** (bytes * 8 - 1)
  for (let i = 0, o = ssnd.start; i < frames; i++) {
    for (let c = 0; c < channels; c++, o += bytes) {
      let x: number
      if (float === 32) x = v.getFloat32(o)
      else if (float === 64) x = v.getFloat64(o)
      else if (bytes === 1) x = v.getInt8(o)
      else if (bytes === 2) x = v.getInt16(o, little)
      else if (bytes === 4) x = v.getInt32(o, little)
      else {
        // 24bit などの半端な幅: 符号付きの整数として1バイトずつ組み立てる
        let n = 0
        for (let k = 0; k < bytes; k++) n = n * 256 + b[o + (little ? bytes - 1 - k : k)]
        x = n >= 2 ** (bytes * 8 - 1) ? n - 2 ** (bytes * 8) : n
      }
      out[c][i] = float ? x : x * scale
    }
  }
  return { sampleRate: Math.round(rate), channels: out }
}

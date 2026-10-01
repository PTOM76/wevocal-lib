import type { Clip, Range } from '../types'

/**
 * 書き出す前の下ごしらえ: 範囲の切り出し、モノラル化、サンプルレートの変換。
 * サンプルレートの変換はブラウザの OfflineAudioContext に任せる（高品質で速い）。
 */
export async function prepareClip(
  clip: Clip,
  opts: { range: Range | null; sampleRate: number; mono: boolean },
): Promise<Clip> {
  let channels = clip.channels
  if (opts.range) {
    const s = Math.max(0, Math.floor(opts.range.start * clip.sampleRate))
    const e = Math.min(channels[0].length, Math.max(s + 1, Math.floor(opts.range.end * clip.sampleRate)))
    channels = channels.map((c) => c.subarray(s, e))
  }
  if (opts.mono && channels.length > 1) {
    const mixed = new Float32Array(channels[0].length)
    for (const c of channels) for (let i = 0; i < mixed.length; i++) mixed[i] += c[i] / channels.length
    channels = [mixed]
  }
  if (opts.sampleRate === clip.sampleRate) return { sampleRate: clip.sampleRate, channels }

  const frames = Math.round((channels[0].length * opts.sampleRate) / clip.sampleRate)
  const ctx = new OfflineAudioContext(channels.length, Math.max(1, frames), opts.sampleRate)
  const buffer = ctx.createBuffer(channels.length, channels[0].length, clip.sampleRate)
  channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i))
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.start()
  const rendered = await ctx.startRendering()
  return {
    sampleRate: opts.sampleRate,
    channels: Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i).slice()),
  }
}

/** -1〜1 の float を 16-bit 整数にする（MP3 エンコーダの入力用） */
export function toInt16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

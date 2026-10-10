// 音声（Clip）の範囲への音量、フェード、ノーマライズと、書き出しの仕上げ（WeVocalSynth と WeVocal Studio で共通）
import type { Clip, Range } from './types'

/** 秒の範囲を、フレームの範囲にする（音声の長さに収める） */
export function toFrames(clip: Clip, range: Range): [number, number] {
  const len = clip.channels[0].length
  const s = Math.max(0, Math.min(len, Math.round(range.start * clip.sampleRate)))
  const e = Math.max(s, Math.min(len, Math.round(range.end * clip.sampleRate)))
  return [s, e]
}


/** 範囲の両端で音量を切り替える長さ（秒。プチッと鳴らないように） */
export const GAIN_RAMP_SEC = 0.005

/**
 * `range` 内の各サンプルに `gainAt(u)` を掛けた新しいクリップを返す。
 * u は範囲内の位置（0〜1）。範囲の両端は短いランプで元の音量につなぐ。
 */
export function mapGain(clip: Clip, range: Range, gainAt: (u: number) => number): Clip {
  const [s, e] = toFrames(clip, range)
  const n = e - s
  const ramp = Math.min(Math.round(GAIN_RAMP_SEC * clip.sampleRate), Math.floor(n / 2))
  return {
    sampleRate: clip.sampleRate,
    channels: clip.channels.map((src) => {
      const out = src.slice()
      for (let i = 0; i < n; i++) {
        let g = gainAt(n > 1 ? i / (n - 1) : 0)
        // 端では 1（元の音量）から目的のゲインへ移る
        const edge = Math.min(i, n - 1 - i)
        if (edge < ramp) g = 1 + (g - 1) * (edge / ramp)
        out[s + i] = src[s + i] * g
      }
      return out
    }),
  }
}

/** `range` の音量を `db` デシベル変える */
export function gainRange(clip: Clip, range: Range, db: number): Clip {
  const g = 10 ** (db / 20)
  return mapGain(clip, range, () => g)
}

/** `range` をフェードイン（'in'）またはフェードアウト（'out'）する。カーブは聴感上なめらかな sin² */
export function fadeRange(clip: Clip, range: Range, dir: 'in' | 'out'): Clip {
  const [s, e] = toFrames(clip, range)
  const n = e - s
  return {
    sampleRate: clip.sampleRate,
    channels: clip.channels.map((src) => {
      const out = src.slice()
      for (let i = 0; i < n; i++) {
        const u = n > 1 ? i / (n - 1) : 1
        const g = Math.sin((Math.PI / 2) * (dir === 'in' ? u : 1 - u)) ** 2
        out[s + i] = src[s + i] * g
      }
      return out
    }),
  }
}

/** `range` のピークが `peakDb` デシベルになるよう音量を揃える。無音なら null */
export function normalizeRange(clip: Clip, range: Range, peakDb = -1): Clip | null {
  const [s, e] = toFrames(clip, range)
  let peak = 0
  for (const c of clip.channels) for (let i = s; i < e; i++) peak = Math.max(peak, Math.abs(c[i]))
  if (peak < 1e-6) return null
  return gainRange(clip, range, peakDb - 20 * Math.log10(peak))
}


/** 書き出すときの仕上げ（ノーマライズと両端のフェード） */
export interface FinishOptions {
  /** 最大の音量を -1dB にそろえる */
  normalize: boolean
  /** 両端にかけるフェードの長さ（ミリ秒。0 ならかけない） */
  fadeMs: number
}

/** `c` に仕上げをかける。フェードは長さの半分までにし、そのあとでノーマライズする（フェードで下がった分は数えない） */
export function finishClip(c: Clip, o: FinishOptions): Clip {
  const dur = (c.channels[0]?.length ?? 0) / c.sampleRate
  if (!(dur > 0)) return c
  let out = c
  if (o.fadeMs > 0) {
    const f = Math.min(o.fadeMs / 1000, dur / 2)
    out = fadeRange(out, { start: 0, end: f }, 'in')
    out = fadeRange(out, { start: dur - f, end: dur }, 'out')
  }
  if (o.normalize) out = normalizeRange(out, { start: 0, end: dur }) ?? out
  return out
}

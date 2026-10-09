// 無音で区切って、音のある所を探す（WeVocalSynth と WeVocal Studio で共通）
import type { Clip, Range } from './types'

/** 無音で区切るときの設定 */
export interface SilenceOptions {
  /** これより小さい音（dBFS）を無音とみなす */
  thresholdDb: number
  /** これより短い無音は区切りにしない（秒。息継ぎや子音の前の短い途切れで分かれないように） */
  minSilenceSec: number
}

export const DEFAULT_SILENCE: SilenceOptions = { thresholdDb: -40, minSilenceSec: 0.2 }

/** 音の大きさを測る間隔（秒） */
const HOP_SEC = 0.01
/** これより短い音は捨てる（秒。クリック音などで小さな範囲ができないように） */
const MIN_SOUND_SEC = 0.05
/** 区切った範囲の前後に足す余白（秒。立ち上がりと余韻を切らないように） */
const PAD_SEC = 0.01

/**
 * `clip` の音のある所（無音で区切った範囲、秒）を返す。全チャンネルのうち大きい方の音で判定する。
 * 10ms ごとの RMS がしきい値より小さい所が `minSilenceSec` 以上続いたら、そこを区切りにする
 */
export function findSounds(clip: Clip, o: SilenceOptions): Range[] {
  const sr = clip.sampleRate
  const len = clip.channels[0]?.length ?? 0
  const hop = Math.max(1, Math.round(sr * HOP_SEC))
  const threshold = 10 ** (o.thresholdDb / 20)
  // 区間ごとに、音があるか
  const loud: boolean[] = []
  for (let s = 0; s < len; s += hop) {
    const e = Math.min(len, s + hop)
    let max = 0
    for (const ch of clip.channels) {
      let sum = 0
      for (let i = s; i < e; i++) sum += ch[i] * ch[i]
      max = Math.max(max, Math.sqrt(sum / (e - s)))
    }
    loud.push(max >= threshold)
  }
  // 音のある区間をつなぎ、短い無音をまたいだものはまとめる
  const minGap = Math.ceil(o.minSilenceSec / HOP_SEC)
  const runs: [number, number][] = []
  for (let i = 0; i < loud.length; i++) {
    if (!loud[i]) continue
    let j = i
    while (j + 1 < loud.length && loud[j + 1]) j++
    const last = runs[runs.length - 1]
    if (last && i - last[1] - 1 < minGap) last[1] = j
    else runs.push([i, j])
    i = j
  }
  const duration = len / sr
  return runs
    .map(([a, b]) => ({ start: Math.max(0, a * HOP_SEC - PAD_SEC), end: Math.min(duration, (b + 1) * HOP_SEC + PAD_SEC) }))
    .filter((r) => r.end - r.start >= MIN_SOUND_SEC + 2 * PAD_SEC)
}

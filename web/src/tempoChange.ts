// 曲の途中でテンポが変わる所を探す（自動解析で見つけたら、テンポのマーカーの候補にする。WeVocalSynth と WeVocal Studio で共通）
import type { Clip } from './types'

/** テンポの解析の候補（強い順に並べて返す。解析はアプリの wasm で行う） */
export interface TempoCandidate {
  bpm: number
  /** 1 番の候補を 1 とした強さ */
  strength: number
  /** 1 拍目の位置（秒） */
  offset: number
}

/** 一定のテンポとして解析する関数（アプリの wasm の窓口） */
export type AnalyzeTempo = (channels: Float32Array[], sampleRate: number) => Promise<TempoCandidate[]>

/** テンポの変化を探す感度（off は探さない） */
export type TempoChangeSensitivity = 'off' | 'low' | 'normal'

/** 見つけたテンポの区間。最初の区間は 0 秒から */
export interface TempoChangeSection {
  /** 区間の始まり（秒） */
  time: number
  bpm: number
  /** 1 拍目の位置（秒） */
  offset: number
}

/** 区間ごとに解析する長さと間隔（秒。半分ずつ重ねる） */
const WINDOW_SEC = 12
const HOP_SEC = 6
/** これより小さい音量（RMS）の区間は判定に使わない */
const SILENCE_RMS = 0.01
/** 倍テンポ、半テンポなどの取り違えとみなす比 */
const CONFUSED_RATIOS = [2, 0.5, 1.5, 2 / 3, 3, 1 / 3]

/** 感度ごとの条件。`diff` は変化とみなす差の割合、`bars` は続く小節の数、`confidence` は区間を判定に使う信頼度の下限 */
const LEVELS = {
  low: { diff: 0.06, bars: 8, confidence: 0.35 },
  normal: { diff: 0.04, bars: 4, confidence: 0.2 },
}

const near = (a: number, b: number, tol: number) => Math.abs(a / b - 1) < tol

/** 区間の信頼度。1 番の候補と、それと倍の関係にない 2 番目の候補の強さの差（強さは 1 番を 1 とした比） */
function confidence(cands: TempoCandidate[]) {
  const best = cands[0]
  if (!best) return 0
  const rival = cands.slice(1).find((c) => !near(c.bpm, best.bpm, 0.03) && !CONFUSED_RATIOS.some((r) => near(c.bpm, best.bpm * r, 0.03)))
  return 1 - (rival?.strength ?? 0)
}

function rms(channels: Float32Array[], from: number, to: number) {
  let sum = 0
  for (const c of channels) for (let i = from; i < to; i++) sum += c[i] * c[i]
  return Math.sqrt(sum / Math.max(1, (to - from) * channels.length))
}

const slice = (clip: Clip, from: number, to: number) => clip.channels.map((c) => c.subarray(Math.floor(from * clip.sampleRate), Math.floor(to * clip.sampleRate)))

/**
 * 途中でテンポが変わるかを調べる。変わらない（か、確かでない）ときは null。誤検知を避けるため、迷ったら変化なしにする。
 * `overall` は曲全体を一定のテンポとして解析した結果、`analyzeTempo` は区間の解析に使う関数
 */
export async function detectTempoChanges(clip: Clip, overall: TempoCandidate, sensitivity: TempoChangeSensitivity, analyzeTempo: AnalyzeTempo): Promise<TempoChangeSection[] | null> {
  if (sensitivity === 'off') return null
  const level = LEVELS[sensitivity]
  const duration = clip.channels[0].length / clip.sampleRate
  if (duration < WINDOW_SEC * 3) return null

  // 区間ごとの BPM（判定に使えない区間は前の値を引き継ぐ）。倍や半分の取り違えに見えるものは前の値に直す
  const values: number[] = []
  let current = overall.bpm
  for (let start = 0; start + WINDOW_SEC <= duration; start += HOP_SEC) {
    const end = start + WINDOW_SEC
    const loud = rms(clip.channels, Math.floor(start * clip.sampleRate), Math.floor(end * clip.sampleRate)) >= SILENCE_RMS
    const cands = loud ? await analyzeTempo(slice(clip, start, end), clip.sampleRate) : []
    const best = cands[0]
    if (best && confidence(cands) >= level.confidence) {
      // 今の値に近い強い候補があれば今の値のまま（少しの揺れで切り替えない）
      const keeps = cands.some((c) => c.strength >= 0.8 && near(c.bpm, current, level.diff))
      const confused = CONFUSED_RATIOS.some((r) => near(best.bpm, current * r, level.diff / 2))
      if (!keeps && !confused) current = best.bpm
    }
    values.push(current)
  }

  // 値のまとまり（続けて近い値の区間）に分け、短いまとまりは前にまとめる
  const runs: { first: number; count: number; bpm: number }[] = []
  for (const [i, v] of values.entries()) {
    const last = runs[runs.length - 1]
    if (last && near(v, last.bpm, level.diff)) last.count++
    else runs.push({ first: i, count: 1, bpm: v })
  }
  const merged: typeof runs = []
  for (const r of runs) {
    const sec = (r.count - 1) * HOP_SEC + WINDOW_SEC
    const long = sec >= (60 / r.bpm) * 4 * level.bars
    const last = merged[merged.length - 1]
    if (last && (!long || near(r.bpm, last.bpm, level.diff))) last.count += r.count
    else merged.push({ ...r })
  }
  if (merged.length < 2) return null

  // まとまりごとに、その範囲だけで解析し直して BPM と 1 拍目を細かく決める
  const out: TempoChangeSection[] = []
  for (const [i, r] of merged.entries()) {
    // 重ねた区間のどこで変わったかはわからないので、境目は前のまとまりの終わりと、このまとまりの始まりの間にする
    const from = i === 0 ? 0 : r.first * HOP_SEC + HOP_SEC / 2
    const next = merged[i + 1]
    const to = next ? next.first * HOP_SEC + HOP_SEC / 2 : duration
    const [best] = await analyzeTempo(slice(clip, from, to), clip.sampleRate)
    const bpm = best && near(best.bpm, r.bpm, level.diff) ? best.bpm : r.bpm
    const prev = out[out.length - 1]
    if (prev && near(bpm, prev.bpm, level.diff)) continue
    // 変わる位置は、その区間の拍の線のうち、境目に一番近い所にそろえる
    const beat = 60 / bpm
    const offset = from + (best?.offset ?? 0)
    const time = i === 0 ? 0 : Math.max(0, offset - Math.round((offset - from) / beat) * beat)
    out.push({ time, bpm, offset: i === 0 ? (best ? offset : overall.offset) : time })
  }
  return out.length >= 2 ? out : null
}

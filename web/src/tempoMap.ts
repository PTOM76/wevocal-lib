// テンポが途中で変わる曲のための、区間ごとのテンポと拍の位置（WeVocalSynth と WeVocal Studio で共通）

/** 曲の頭のテンポ（WeVocalSynth の ProjectTempo と同じ形） */
export interface BaseTempo {
  bpm: number
  beatsPerBar: number
  /** 1 拍目の位置（秒） */
  beatOffset: number
}

/** テンポを持つマーカー（その位置からテンポが変わる） */
export interface TempoMarker {
  time: number
  tempo?: { bpm: number; beatsPerBar: number }
}

/**
 * テンポが途中で変わる曲のための、区間ごとのテンポ。プロジェクトのテンポで始まり、テンポを持つマーカーの位置から
 * そのテンポに変わる（拍はマーカーの位置から数え直す）。拍の線、拍への吸着、← → の移動、BPM を使う加工はこれで計算する
 */
export interface TempoSegment {
  /** 区間の始まり（秒）。最初の区間は -Infinity */
  start: number
  bpm: number
  beatsPerBar: number
  /** 1 拍目（小節の頭）の位置（秒） */
  offset: number
  /** `offset` の小節の番号（前の区間から続けて数える。途中で切れた小節も 1 つと数える） */
  firstBar: number
}

/** 拍の線 1 本 */
export interface Beat {
  time: number
  /** 小節の頭か */
  bar: boolean
  /** 小節の番号（1 拍目の小節が 1。前の区間から続けて数える） */
  barNo: number
  /** その区間の 1 拍と 1 小節の長さ（秒。線を間引くのに使う） */
  beatSec: number
  barSec: number
}

/** 区間の並び（始まりの順）。BPM が 0 以下の区間は作らない */
export function tempoSegments(base: BaseTempo, markers: readonly TempoMarker[]): TempoSegment[] {
  const segs: TempoSegment[] = [{ start: -Infinity, bpm: base.bpm, beatsPerBar: Math.max(1, base.beatsPerBar), offset: base.beatOffset, firstBar: 1 }]
  for (const m of [...markers].sort((a, b) => a.time - b.time)) {
    if (!m.tempo || !(m.tempo.bpm > 0)) continue
    const prev = segs[segs.length - 1]
    // 前の区間で、この位置より前に始まった最後の小節の次の番号
    const k = Math.ceil((m.time - prev.offset) / (60 / prev.bpm) - 1e-9)
    const firstBar = prev.firstBar + Math.floor((k - 1) / prev.beatsPerBar) + 1
    segs.push({ start: m.time, bpm: m.tempo.bpm, beatsPerBar: Math.max(1, m.tempo.beatsPerBar), offset: m.time, firstBar })
  }
  return segs.filter((s) => s.bpm > 0)
}

/** `t` の区間の番号 */
function indexAt(segs: TempoSegment[], t: number) {
  let i = 0
  while (i + 1 < segs.length && segs[i + 1].start <= t) i++
  return i
}

/** `t` の区間（区間がなければ undefined） */
export const segmentAt = (segs: TempoSegment[], t: number): TempoSegment | undefined => segs[indexAt(segs, t)]

/** `t` での BPM */
export const bpmAt = (segs: TempoSegment[], t: number) => segmentAt(segs, t)?.bpm ?? 0

/** `from` から `to` までの拍の線（区間の境目では、次の区間の 1 拍目から数え直す） */
export function beatsIn(segs: TempoSegment[], from: number, to: number): Beat[] {
  const out: Beat[] = []
  for (const [i, s] of segs.entries()) {
    const end = segs[i + 1]?.start ?? Infinity
    const a = Math.max(from, s.start)
    const b = Math.min(to, end)
    if (a > b) continue
    const beat = 60 / s.bpm
    for (let k = Math.ceil((a - s.offset) / beat - 1e-9); s.offset + k * beat <= b + 1e-9; k++) {
      const time = s.offset + k * beat
      // 次の区間の始まりと重なる線は、次の区間で描く
      if (time >= end - 1e-9) break
      const isBar = ((k % s.beatsPerBar) + s.beatsPerBar) % s.beatsPerBar === 0
      out.push({ time, bar: isBar, barNo: s.firstBar + Math.floor(k / s.beatsPerBar), beatSec: beat, barSec: beat * s.beatsPerBar })
    }
  }
  return out
}

/** `t` に一番近い拍の線 */
export function nearestBeat(segs: TempoSegment[], t: number) {
  const s = segs[indexAt(segs, t)]
  if (!s) return t
  const beat = 60 / s.bpm
  let best = s.offset + Math.round((t - s.offset) / beat) * beat
  // 区間の境目（次の区間の 1 拍目）のほうが近ければそちら
  const next = segs[indexAt(segs, t) + 1]
  if (next && Math.abs(next.start - t) < Math.abs(best - t)) best = next.start
  if (best < s.start) best = s.start
  return best
}

/** `t` から前（dir=-1）・後ろ（1）の拍の線。`t` がちょうど線の上なら隣の線 */
export function stepBeat(segs: TempoSegment[], t: number, dir: -1 | 1) {
  const i = indexAt(segs, t)
  const s = segs[i]
  if (!s) return t + dir
  const beat = 60 / s.bpm
  const k = (t - s.offset) / beat
  const n = dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1
  let next = s.offset + n * beat
  // 区間をまたぐときは、境目（次の区間の 1 拍目 / この区間の始まり）で止まる
  const after = segs[i + 1]
  if (dir > 0 && after && next > after.start + 1e-6) next = after.start
  if (dir < 0 && next < s.start - 1e-6) next = t - s.start > 1e-6 ? s.start : stepBeat(segs, s.start - 1e-6, -1)
  return next
}

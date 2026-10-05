import type { Clip } from '../types'
import type { View } from './view'

/** 最も細かい段のブロックの大きさ（サンプル）。これより細かく見るときはサンプルを直接走査する */
const BASE_BLOCK = 256

/**
 * 波形の表示用に、最小値・最大値をブロックごとにまとめた表（ピラミッド）。
 * 段 k は BASE_BLOCK × 2^k サンプルずつまとめる。全チャンネルを通した値を持つ。
 * 拡大縮小やスクロールのたびに表示範囲の全サンプルを走査すると、引いた表示で重くなるため、
 * クリップごとに1回だけ作って使い回す
 */
interface Pyramid {
  levels: { min: Float32Array; max: Float32Array }[]
}

// クリップが使われなくなれば表も一緒に消えるよう、WeakMap で持つ
const cache = new WeakMap<Clip, Pyramid>()

function build(clip: Clip): Pyramid {
  const len = clip.channels[0].length
  const n0 = Math.ceil(len / BASE_BLOCK)
  const min = new Float32Array(n0)
  const max = new Float32Array(n0)
  for (let b = 0; b < n0; b++) {
    let lo = 0
    let hi = 0
    const end = Math.min(len, (b + 1) * BASE_BLOCK)
    for (const ch of clip.channels) {
      for (let i = b * BASE_BLOCK; i < end; i++) {
        const v = ch[i]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    min[b] = lo
    max[b] = hi
  }
  const levels = [{ min, max }]
  // 隣り合う2ブロックずつまとめて、次の段を作る
  while (levels[levels.length - 1].min.length > 1) {
    const prev = levels[levels.length - 1]
    const n = Math.ceil(prev.min.length / 2)
    const lmin = new Float32Array(n)
    const lmax = new Float32Array(n)
    for (let b = 0; b < n; b++) {
      const j = Math.min(2 * b + 1, prev.min.length - 1)
      lmin[b] = Math.min(prev.min[2 * b], prev.min[j])
      lmax[b] = Math.max(prev.max[2 * b], prev.max[j])
    }
    levels.push({ min: lmin, max: lmax })
  }
  return { levels }
}

/** 表を作ったときに呼ぶ関数（アプリの計測用。なければ何もしない） */
let onBuild: (() => void) | null = null
export function setPeaksOnBuild(fn: (() => void) | null) {
  onBuild = fn
}

/** 表示範囲について、全チャンネルを通した1ピクセル列ごとの最小値・最大値を求める */
export function computePeaks(clip: Clip, width: number, view: View) {
  const len = clip.channels[0].length
  const sr = clip.sampleRate
  const min = new Float32Array(width)
  const max = new Float32Array(width)
  const samplesPerPixel = (view.dur * sr) / Math.max(1, width)

  // 1ピクセルに2ブロック以上入る、最も粗い段を使う（細かく見るときはサンプルを直接走査する）
  let level = -1
  while (BASE_BLOCK * 2 ** (level + 1) * 2 <= samplesPerPixel) level++
  let pyramid: Pyramid | null = null
  if (level >= 0) {
    pyramid = cache.get(clip) ?? (onBuild?.(), build(clip))
    cache.set(clip, pyramid)
    level = Math.min(level, pyramid.levels.length - 1)
  }

  for (let x = 0; x < width; x++) {
    const a = Math.max(0, Math.floor((view.start + (x / width) * view.dur) * sr))
    const b = Math.min(len, Math.max(a + 1, Math.floor((view.start + ((x + 1) / width) * view.dur) * sr)))
    const r = { lo: 0, hi: 0 }
    rangeMinMax(clip, pyramid, level, a, b, r)
    min[x] = r.lo
    max[x] = r.hi
  }
  return { min, max }
}

/**
 * サンプル区間 [a, b) の最小値・最大値を `r` に足し込む。段 `level` のブロックのうち区間に完全に
 * 収まるものだけを使い、はみ出す両端は1段細かい段で埋める（最後はサンプルを直接見る）。
 * ブロックの境目がピクセルの境目とそろわなくても、隣のピクセルの山を拾わない
 */
function rangeMinMax(clip: Clip, pyramid: Pyramid | null, level: number, a: number, b: number, r: { lo: number; hi: number }) {
  if (a >= b) return
  if (!pyramid || level < 0) {
    for (const ch of clip.channels) {
      for (let i = a; i < b; i++) {
        const v = ch[i]
        if (v < r.lo) r.lo = v
        if (v > r.hi) r.hi = v
      }
    }
    return
  }
  const block = BASE_BLOCK * 2 ** level
  const k0 = Math.ceil(a / block)
  const k1 = Math.floor(b / block)
  if (k0 >= k1) return rangeMinMax(clip, pyramid, level - 1, a, b, r)
  const { min, max } = pyramid.levels[level]
  for (let k = k0; k < k1; k++) {
    if (min[k] < r.lo) r.lo = min[k]
    if (max[k] > r.hi) r.hi = max[k]
  }
  rangeMinMax(clip, pyramid, level - 1, a, k0 * block, r)
  rangeMinMax(clip, pyramid, level - 1, k1 * block, b, r)
}

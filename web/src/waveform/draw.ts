import type { Range } from '../types'
import { alpha, type WaveColors } from './colors'
import { timeToX, type View } from './view'

/** 上端の時間目盛りの高さ */
export const RULER_HEIGHT = 24

/** 波形の描画に共通のコンテキスト。アプリはこれを広げて自分の帯の情報を足す */
export interface WaveDrawContext {
  g: CanvasRenderingContext2D
  width: number
  view: View
  colors: WaveColors
  /** 波形の帯の高さ（上端は目盛りのすぐ下） */
  waveH: number
}

const toX = ({ width, view }: WaveDrawContext, t: number) => timeToX(width, view, t)

/** ラベル間隔が約80px以上になるよう、きりのよい目盛り間隔を選ぶ */
function rulerStep(duration: number, width: number) {
  const target = (duration * 80) / Math.max(width, 1)
  const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
  return steps.find((s) => s >= target) ?? 600
}

/**
 * Canvas の大きさを `w` × `h` にして、描く前の状態（真っさらで、設定も初期値）にする。
 * 大きさが同じなら作り直さずに reset で済ませる（width を代入すると、同じ大きさでも画像の領域を確保し直し、
 * 描き直すたびにメモリの掃除が増えて画面が止まる原因になった）
 */
export function prepareCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
  const g = canvas.getContext('2d')
  if (canvas.width === w && canvas.height === h && g && 'reset' in g) {
    g.reset()
    return g
  }
  canvas.width = w
  canvas.height = h
  return g
}

/** 上端の時間目盛り */
export function drawRuler(c: WaveDrawContext) {
  const { g, width, view, colors } = c
  g.fillStyle = colors.textSecondary
  g.strokeStyle = colors.divider
  const step = rulerStep(view.dur, width)
  const digits = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0
  for (let t = Math.ceil(view.start / step) * step; t <= view.start + view.dur; t += step) {
    const x = Math.round(toX(c, t)) + 0.5
    g.beginPath()
    g.moveTo(x, RULER_HEIGHT - 6)
    g.lineTo(x, RULER_HEIGHT)
    g.stroke()
    const m = Math.floor(t / 60)
    const label = m > 0 ? `${m}:${(t - m * 60).toFixed(digits).padStart(digits ? digits + 3 : 2, '0')}` : t.toFixed(digits)
    g.fillText(label, x + 3, RULER_HEIGHT / 2 - 2)
  }
  g.beginPath()
  g.moveTo(0, RULER_HEIGHT - 0.5)
  g.lineTo(width, RULER_HEIGHT - 0.5)
  g.stroke()
}

/** 選択範囲の塗りと両端の線（高さ `h` まで） */
export function drawSelection(c: WaveDrawContext, selection: Range, h: number) {
  const { g, colors } = c
  const x0 = toX(c, selection.start)
  const x1 = toX(c, selection.end)
  g.fillStyle = alpha(colors.selection, 0.14)
  g.fillRect(x0, RULER_HEIGHT, x1 - x0, h - RULER_HEIGHT)
  g.fillStyle = colors.selection
  g.fillRect(x0 - 1, RULER_HEIGHT, 2, h - RULER_HEIGHT)
  g.fillRect(x1 - 1, RULER_HEIGHT, 2, h - RULER_HEIGHT)
}

/** 選択範囲の両端のつまみ（指でつかむ所。両端の線の下端に丸を描く） */
export function drawSelectionHandles(c: WaveDrawContext, selection: Range, h: number) {
  const { g, colors } = c
  g.fillStyle = colors.selection
  for (const t of [selection.start, selection.end]) {
    g.beginPath()
    g.arc(toX(c, t), h - 14, 8, 0, Math.PI * 2)
    g.fill()
  }
}

/** ほかのトラックの波形を、大きな波形の後ろに薄く描く（タイミングを見比べるため。中央線は描かない） */
export function drawGhostWave(c: WaveDrawContext, peaks: { min: Float32Array; max: Float32Array }, scale = 1) {
  const { g, width, colors, waveH } = c
  const mid = RULER_HEIGHT + waveH / 2
  const amp = (waveH / 2 - 4) * scale
  const lim = waveH / 2 - 4
  g.fillStyle = alpha(colors.textSecondary, 0.28)
  for (let x = 0; x < width; x++) {
    const y0 = mid - Math.min(lim, peaks.max[x] * amp)
    const y1 = mid - Math.max(-lim, peaks.min[x] * amp)
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0))
  }
}

/** 波形（1ピクセル列ごとの最小値〜最大値の縦線）と中央線。`dim` ならほかのものを重ねるので薄く描く */
export function drawWave(c: WaveDrawContext, peaks: { min: Float32Array; max: Float32Array }, scale = 1, dim = false) {
  const { g, width, colors, waveH } = c
  const mid = RULER_HEIGHT + waveH / 2
  // 縦の拡大（`scale` 倍）。帯からはみ出す分は端で切る
  const amp = (waveH / 2 - 4) * scale
  const lim = waveH / 2 - 4
  g.fillStyle = alpha(colors.wave, dim ? 0.3 : 0.85)
  for (let x = 0; x < width; x++) {
    const y0 = mid - Math.min(lim, peaks.max[x] * amp)
    const y1 = mid - Math.max(-lim, peaks.min[x] * amp)
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0))
  }
  g.fillStyle = colors.divider
  g.fillRect(0, mid, width, 1)
  if (scale > 1) {
    g.fillStyle = colors.textSecondary
    g.fillText(`×${scale}`, width - 32, RULER_HEIGHT + 12)
  }
}

/** 再生位置の縦線 */
export function drawPlayhead(c: WaveDrawContext, position: number, h: number) {
  c.g.fillStyle = c.colors.text
  c.g.fillRect(Math.round(toX(c, position)) - 1, 0, 2, h)
}

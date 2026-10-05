import type { RefObject } from 'react'
import type { Range } from '../types'
import type { View } from '../waveform/view'

/** 範囲の端をつかめる距離（px） */
const EDGE_GRAB_PX = 6
/** 端のドラッグで縮められる最小の範囲（秒） */
const MIN_RANGE_SEC = 0.01
export /** 範囲の端のドラッグ。stretch なら離したときにその長さまで伸縮する */
interface EdgeDrag {
  index: number
  side: 'start' | 'end'
  stretch: boolean
  orig: Range
  last: Range
}

/** 選択範囲の端をつかんで動かす処理。`timeAt` は画面の x 座標から時刻を求める関数 */
export function useRangeEdges(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  view: View,
  selections: Range[],
  timeAt: (clientX: number) => number,
  onSelectionsChange: (rs: Range[]) => void,
) {
  /** `clientX` の近くにある範囲の端（なければ null）。`grabPx` はつかめる距離（スマホのつまみは広く取る） */
  const edgeAt = (clientX: number, grabPx = EDGE_GRAB_PX): { index: number; side: 'start' | 'end' } | null => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const xOf = (t: number) => rect.left + ((t - view.start) / view.dur) * rect.width
    let best: { index: number; side: 'start' | 'end'; d: number } | null = null
    selections.forEach((r, index) => {
      for (const side of ['start', 'end'] as const) {
        const d = Math.abs(xOf(r[side]) - clientX)
        if (d <= grabPx && (!best || d < best.d)) best = { index, side, d }
      }
    })
    return best
  }

  /** 端のドラッグ中の範囲を更新する */
  const dragEdge = (edge: EdgeDrag, clientX: number) => {
    const t = timeAt(clientX)
    const { orig } = edge
    edge.last =
      edge.side === 'start'
        ? { start: Math.min(t, orig.end - MIN_RANGE_SEC), end: orig.end }
        : { start: orig.start, end: Math.max(t, orig.start + MIN_RANGE_SEC) }
    onSelectionsChange(selections.map((r, i) => (i === edge.index ? edge.last : r)))
  }

  return { edgeAt, dragEdge }
}

import { useRef, type RefObject } from 'react'
import type { View } from '../waveform/view'

/** 目盛りを押したまま動かさずにいると、横移動モードに入るまでの時間（ミリ秒） */
const RULER_HOLD_MS = 400
/** 押したまま動いたとみなす距離（px）。これより動いたら長押しではなく再生位置のドラッグ */
const HOLD_SLOP_PX = 8
/** ピンチの2本指の横の間隔の最小値（px）。指が重なったときに拡大率が跳ばないようにする */
const MIN_PINCH_PX = 24

interface Options {
  canvasRef: RefObject<HTMLCanvasElement | null>
  view: View
  setRange: (start: number, dur: number) => void
  /** 目盛りのタップ・ドラッグで再生位置を動かす */
  seekAt: (clientX: number) => void
}

/**
 * 波形のタッチ操作（スマホ）。
 * - 2本指のピンチ: 横方向の拡大縮小（2本の指の間の時間が指に付いてくる）
 * - 目盛りの操作: タップで再生位置へ、そのままドラッグで再生位置を動かす、動かさずに長押しすると横移動モード
 * 波形の範囲選択・ペン描画は Waveform 側のまま。ピンチが始まったら、それらは取り消してもらう
 */
export function useTouchGestures(o: Options) {
  const pointers = useRef(new Map<number, number>())
  const pinch = useRef<{ view: View; dx: number; tMid: number } | null>(null)
  const ruler = useRef<{ x0: number; mode: 'wait' | 'scrub' | 'pan'; timer: number; start0: number; dur: number } | null>(null)
  const latest = useRef(o)
  latest.current = o

  const rect = () => latest.current.canvasRef.current!.getBoundingClientRect()
  const timeAt = (x: number, v: View) => {
    const r = rect()
    return v.start + ((x - r.left) / r.width) * v.dur
  }

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()]
    const v = latest.current.view
    pinch.current = { view: v, dx: Math.max(MIN_PINCH_PX, Math.abs(a - b)), tMid: timeAt((a + b) / 2, v) }
  }

  const cancelRuler = () => {
    if (ruler.current) clearTimeout(ruler.current.timer)
    ruler.current = null
  }

  return {
    /** タッチの指が触れたとき。ピンチが始まったら true（呼び出し側は進行中の選択などを取り消す） */
    down(e: React.PointerEvent): boolean {
      if (e.pointerType !== 'touch') return false
      pointers.current.set(e.pointerId, e.clientX)
      if (pointers.current.size === 2) {
        cancelRuler()
        startPinch()
        return true
      }
      return pinch.current !== null
    },

    /** タッチで目盛りを押したとき。すぐには再生位置を動かさず、タップ・ドラッグ・長押しを見分ける */
    rulerDown(e: React.PointerEvent) {
      const v = latest.current.view
      const x0 = e.clientX
      const timer = window.setTimeout(() => {
        if (ruler.current?.mode !== 'wait') return
        ruler.current.mode = 'pan'
        navigator.vibrate?.(10)
      }, RULER_HOLD_MS)
      ruler.current = { x0, mode: 'wait', timer, start0: v.start, dur: v.dur }
    },

    /** 動いたとき。このフックで扱ったら true */
    move(e: React.PointerEvent): boolean {
      if (e.pointerType !== 'touch') return false
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, e.clientX)
      const p = pinch.current
      if (p) {
        if (pointers.current.size < 2) return true
        const [a, b] = [...pointers.current.values()]
        const r = rect()
        const dur = p.view.dur * (p.dx / Math.max(MIN_PINCH_PX, Math.abs(a - b)))
        // ピンチを始めたときに2本の指の真ん中にあった時間を、今の真ん中に合わせる
        const mid = ((a + b) / 2 - r.left) / r.width
        latest.current.setRange(p.tMid - mid * dur, dur)
        return true
      }
      const g = ruler.current
      if (!g) return false
      if (g.mode === 'wait' && Math.abs(e.clientX - g.x0) > HOLD_SLOP_PX) {
        clearTimeout(g.timer)
        g.mode = 'scrub'
      }
      if (g.mode === 'scrub') latest.current.seekAt(e.clientX)
      // 横移動モード: 指に付いて表示範囲が動く
      if (g.mode === 'pan') latest.current.setRange(g.start0 - ((e.clientX - g.x0) / rect().width) * g.dur, g.dur)
      return true
    },

    /** 離れたとき。このフックで扱ったら true */
    up(e: React.PointerEvent): boolean {
      if (e.pointerType !== 'touch') return false
      pointers.current.delete(e.pointerId)
      if (pinch.current) {
        // 全部の指が離れるまでは、残った指で選択などを始めない
        if (pointers.current.size === 0) pinch.current = null
        return true
      }
      const g = ruler.current
      if (!g) return false
      // 動かさずに離したら、タップとして再生位置へ
      if (g.mode === 'wait') latest.current.seekAt(e.clientX)
      cancelRuler()
      return true
    },
  }
}

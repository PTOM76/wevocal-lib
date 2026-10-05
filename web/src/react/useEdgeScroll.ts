import { useEffect, useRef, type RefObject } from 'react'
import type { View } from '../waveform/view'

/** 端から何 px 以内に来たら流し始めるか */
const EDGE_PX = 32
/** 一番端（またはその外）にいるときの流れる速さ（1秒あたり、表示幅の何倍） */
const MAX_SPEED = 1.5

interface Options {
  canvasRef: RefObject<HTMLCanvasElement | null>
  view: View
  duration: number
  setRange: (start: number, dur: number) => void
  /** 流している間、再生位置をその端に合わせる */
  seek: (t: number) => void
}

/**
 * 目盛りのドラッグ中に指（マウス）が波形の端に来たら、表示範囲をその方向へ流し続ける。
 * 端で止まって先へ進めなくなるのを防ぐ。端に近いほど速い
 */
export function useEdgeScroll(o: Options) {
  const latest = useRef(o)
  latest.current = o
  const xRef = useRef<number | null>(null)
  const rafRef = useRef(0)

  const stop = () => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    xRef.current = null
  }
  useEffect(() => stop, [])

  const loop = (prev: number) => (now: number) => {
    const x = xRef.current
    const canvas = latest.current.canvasRef.current
    if (x === null || !canvas) return stop()
    const r = canvas.getBoundingClientRect()
    // 端からの食い込み（-1〜1。負なら左、正なら右、0 なら流さない）
    const depth = x > r.right - EDGE_PX ? Math.min(1, (x - (r.right - EDGE_PX)) / EDGE_PX) : x < r.left + EDGE_PX ? -Math.min(1, (r.left + EDGE_PX - x) / EDGE_PX) : 0
    if (depth !== 0) {
      const { view, duration, setRange, seek } = latest.current
      const start = Math.max(0, Math.min(duration - view.dur, view.start + depth * MAX_SPEED * view.dur * ((now - prev) / 1000)))
      setRange(start, view.dur)
      seek(depth > 0 ? Math.min(duration, start + view.dur) : start)
    }
    rafRef.current = requestAnimationFrame(loop(now))
  }

  return {
    /** ドラッグ中の位置を伝える（端に入ったら流れ始める） */
    update(clientX: number) {
      xRef.current = clientX
      if (!rafRef.current) rafRef.current = requestAnimationFrame(loop(performance.now()))
    },
    stop,
  }
}

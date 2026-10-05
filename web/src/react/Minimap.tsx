import { useEffect, useMemo, useRef, useState } from 'react'
import type { Clip, Range } from '../types'
import { alpha, type WaveColors } from '../waveform/colors'
import { computePeaks } from '../waveform/peaks'
import type { View } from '../waveform/view'

const HEIGHT = 28

interface Props {
  clip: Clip
  /** 色（本体の波形と同じもの） */
  colors: WaveColors
  duration: number
  view: View
  selections: Range[]
  /** 表示開始位置を変更する */
  scrollTo: (start: number) => void
  label: string
  /** 再生位置（秒） */
  position: number
  /** 再生中は毎フレーム今の位置を返す */
  livePosition?: () => number
  playing: boolean
  /** 再生位置の線を表示する */
  showPlayhead: boolean
}

/** 全体を縮小した波形。今の表示範囲を枠で示し、ドラッグやクリックで移動する */
export default function Minimap({ clip, colors, duration, view, selections, scrollTo, label, position, livePosition, playing, showPlayhead }: Props) {
  const headRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  // ドラッグ中: 押した時刻と、そのときの表示開始位置
  const drag = useRef<{ t0: number; start0: number } | null>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 全体の波形は表示範囲が変わっても同じなので、クリップと幅が変わったときだけ求める
  const peaks = useMemo(() => (width > 0 && duration > 0 ? computePeaks(clip, width, { start: 0, dur: duration }) : null), [clip, width, duration])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = HEIGHT * dpr
    const g = canvas.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, HEIGHT)
    const x = (t: number) => (t / duration) * width
    // 色は本体の波形に合わせる（波形は青、選択範囲はシアン、再生位置は文字色）
    g.fillStyle = alpha(colors.selection, 0.3)
    for (const r of selections) g.fillRect(x(r.start), 0, Math.max(1, x(r.end) - x(r.start)), HEIGHT)
    const mid = HEIGHT / 2
    g.fillStyle = alpha(colors.wave, 0.6)
    for (let i = 0; i < width; i++) {
      const y0 = mid - peaks.max[i] * mid
      g.fillRect(i, y0, 1, Math.max(1, mid - peaks.min[i] * mid - y0))
    }
    // 今の表示範囲
    const x0 = x(view.start)
    const w = Math.max(2, x(view.start + view.dur) - x0)
    g.fillStyle = alpha(colors.wave, 0.15)
    g.fillRect(x0, 0, w, HEIGHT)
    g.strokeStyle = colors.wave
    g.lineWidth = 1.5
    g.strokeRect(x0 + 0.75, 0.75, w - 1.5, HEIGHT - 1.5)
  }, [peaks, width, duration, view, selections, colors])

  // 再生位置の線。再生中は React の再描画を待たず、毎フレーム動かす
  useEffect(() => {
    const el = headRef.current
    if (!el || duration <= 0 || !showPlayhead) return
    const put = (t: number) => (el.style.left = `${Math.min(100, Math.max(0, (t / duration) * 100))}%`)
    put(position)
    if (!playing || !livePosition) return
    let id = requestAnimationFrame(function tick() {
      put(livePosition())
      id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
  }, [position, playing, livePosition, duration, showPlayhead])

  const timeAt = (clientX: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return ((clientX - rect.left) / Math.max(1, rect.width)) * duration
  }

  return (
    <div ref={boxRef} style={{ flex: 1, minWidth: 0, height: HEIGHT, position: 'relative' }}>
      <canvas
        ref={canvasRef}
        role="scrollbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={view.start}
        style={{ width: '100%', height: HEIGHT, display: 'block', cursor: 'pointer', touchAction: 'none' }}
        onPointerDown={(e) => {
          const t = timeAt(e.clientX)
          // 枠の外を押したら、そこを中心に移動してからドラッグを続ける
          const inside = t >= view.start && t <= view.start + view.dur
          const start0 = inside ? view.start : t - view.dur / 2
          if (!inside) scrollTo(start0)
          drag.current = { t0: t, start0 }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d) scrollTo(d.start0 + timeAt(e.clientX) - d.t0)
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      {showPlayhead && <div ref={headRef} style={{ position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, background: colors.text, pointerEvents: 'none' }} />}
    </div>
  )
}

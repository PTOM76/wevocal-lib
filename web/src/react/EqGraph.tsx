// グラフィック EQ のグラフ（なぞって値を描く）。WeVocalSynth と WeVocal Studio で共通。MUI を使わないので、色と文言は受け取る
import { useRef, useState } from 'react'
import { eqFreqs, eqRange, type TrackEq } from '../effects/eq'

const W = 600
const H = 220
const PAD_X = 16
const PAD_Y = 12

/** グラフの色（アプリのテーマから渡す。SVG は CSS 変数を使えないため） */
export interface EqGraphColors {
  background: string
  divider: string
  text: string
  textSecondary: string
  line: string
  disabled: string
}

const fmtHz = (f: number) => (f >= 1000 ? `${f / 1000}k` : `${f}`)

/**
 * グラフィック EQ のグラフ。なぞると通った帯の値がその高さになる（速く動かして飛ばした帯は間を直線で埋める）。
 * Shift は押した帯だけを細かく動かす、Alt はなぞった帯を両隣となじませる、ダブルクリックはその帯を 0 dB に戻す
 */
export default function EqGraph(p: { eq: TrackEq; onChange: (gains: number[]) => void; colors: EqGraphColors; label: string }) {
  const c = p.colors
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef<{ band: number; db: number; fine: boolean; startY: number; startDb: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const n = p.eq.bands
  const max = eqRange(p.eq)
  const round = (db: number) => Math.round(Math.max(-max, Math.min(max, db)) * 10) / 10
  const freqs = eqFreqs(n)
  const xOf = (i: number) => PAD_X + ((W - PAD_X * 2) * (i + 0.5)) / n
  const yOf = (db: number) => H / 2 - (db / max) * (H / 2 - PAD_Y)
  const gains = p.eq.gains

  /** 画面の位置を、帯の番号と dB にする */
  const at = (e: React.PointerEvent | React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const y = ((e.clientY - r.top) / r.height) * H
    const band = Math.max(0, Math.min(n - 1, Math.floor(((x - PAD_X) / (W - PAD_X * 2)) * n)))
    return { band, db: round(((H / 2 - y) / (H / 2 - PAD_Y)) * max), y }
  }

  const paint = (from: { band: number; db: number }, to: { band: number; db: number }, smooth: boolean) => {
    const g = [...gains]
    const lo = Math.min(from.band, to.band)
    const hi = Math.max(from.band, to.band)
    for (let i = lo; i <= hi; i++) {
      if (smooth) {
        g[i] = round(((gains[i - 1] ?? gains[i]) + gains[i] + (gains[i + 1] ?? gains[i])) / 3)
        continue
      }
      const r = hi === lo ? 1 : (i - from.band) / (to.band - from.band)
      g[i] = round(from.db + (to.db - from.db) * r)
    }
    p.onChange(g)
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const a = at(e)
    drag.current = { band: a.band, db: a.db, fine: e.shiftKey, startY: a.y, startDb: gains[a.band] }
    if (!e.shiftKey) paint(a, a, e.altKey)
  }
  const onMove = (e: React.PointerEvent) => {
    const a = at(e)
    setHover(a.band)
    const d = drag.current
    if (!d) return
    if (d.fine) {
      // 押した帯だけを、動かした量の 1/4 で動かす
      const g = [...gains]
      g[d.band] = round(d.startDb + ((d.startY - a.y) / (H / 2 - PAD_Y)) * max * 0.25)
      p.onChange(g)
      return
    }
    paint(d, a, e.altKey)
    drag.current = { ...d, band: a.band, db: a.db }
  }
  const onUp = () => {
    drag.current = null
  }
  const onDouble = (e: React.MouseEvent) => {
    const g = [...gains]
    g[at(e).band] = 0
    p.onChange(g)
  }

  const line = gains.map((g, i) => `${xOf(i)},${yOf(g)}`).join(' ')
  const muted = !p.eq.on
  // 31 帯は文字が重なるので、3 つおきに書く
  const labelEvery = n > 10 ? 3 : 1
  return (
    <div>
      <div style={{ fontSize: 11, color: c.textSecondary, minHeight: 18, textAlign: 'right' }}>
        {hover != null && `${fmtHz(freqs[hover])} Hz  ${gains[hover] > 0 ? '+' : ''}${gains[hover].toFixed(1)} dB`}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={p.label}
        style={{ width: '100%', height: 'auto', touchAction: 'none', cursor: 'crosshair', display: 'block', userSelect: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={onDouble}
      >
        <rect x={0} y={0} width={W} height={H} fill={c.background} rx={4} />
        {[-1, -0.5, 0, 0.5, 1].map((r) => r * max).map((db) => (
          <g key={db}>
            <line x1={PAD_X} x2={W - PAD_X} y1={yOf(db)} y2={yOf(db)} stroke={c.divider} strokeWidth={db === 0 ? 1.5 : 1} />
            <text x={2} y={yOf(db) + 4} fontSize={10} fill={c.textSecondary}>
              {db > 0 ? `+${db}` : db}
            </text>
          </g>
        ))}
        <polyline points={line} fill="none" stroke={muted ? c.disabled : c.line} strokeWidth={2} strokeLinejoin="round" />
        {gains.map((g, i) => (
          <circle key={i} cx={xOf(i)} cy={yOf(g)} r={(n > 10 ? 2.5 : 4) * (hover === i ? 1.6 : 1)} fill={muted ? c.disabled : c.line} />
        ))}
      </svg>
      <div style={{ position: 'relative', height: 16, fontSize: 10, color: c.textSecondary }}>
        {freqs.map((f, i) =>
          i % labelEvery ? null : (
            <span key={i} style={{ position: 'absolute', left: `${(xOf(i) / W) * 100}%`, transform: 'translateX(-50%)' }}>
              {fmtHz(f)}
            </span>
          ),
        )}
      </div>
    </div>
  )
}

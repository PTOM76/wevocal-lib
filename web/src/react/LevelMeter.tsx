import { useEffect, useRef } from 'react'
import { alpha } from '../waveform/colors'

/** 表示する範囲（dB） */
const MIN_DB = -60
/** 表示が下がる速さ（dB / 秒）。上がるときはすぐ上げる */
const FALL_DB_PER_SEC = 30
/** ピークの印を残す時間（秒） */
const HOLD_SEC = 1
/** 再生していなくて表示も消えきったときの、確認の間隔（ミリ秒）。毎フレーム動かし続けないため */
const IDLE_MS = 250
/** LED の1区切りの幅と、区切りの間のすき間（CSS px） */
const SEG_W = 3
const SEG_GAP = 1
/** 行（左右など）の間のすき間（CSS px） */
const ROW_GAP = 1

const toRatio = (db: number) => Math.max(0, Math.min(1, (db - MIN_DB) / -MIN_DB))

/** 色（-12dB まで、-3dB まで、それより上） */
export interface MeterColors {
  low: string
  mid: string
  high: string
}

/** 測る対象。1つなら1行、配列なら行ごと（全体の左・右など） */
type Source = () => AnalyserNode | readonly AnalyserNode[] | null

/**
 * 横向きの LED 風レベルメーター。`source` が返す AnalyserNode のピークを、毎フレーム Canvas に直接描く
 * （React の状態にすると、毎フレーム画面が描き直されて重くなるため。再生位置の線と同じ）。
 * 再生していないとき（source が null）は、ゆっくり下がって消える
 */
export function LevelMeter({ source, colors, pixelRatio = () => window.devicePixelRatio || 1, rows = 1, width = 64, height = 6, label }: {
  source: Source
  colors: MeterColors
  /** Canvas の解像度（画面の倍率を変えるアプリは、それを掛けた値を返す） */
  pixelRatio?: () => number
  rows?: number
  width?: number
  height?: number
  label: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  // 描画のたびに作られる関数でもループを作り直さないよう、最新の source は ref から読む
  const sourceRef = useRef(source)
  sourceRef.current = source

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = pixelRatio()
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    const g = canvas.getContext('2d')
    if (!g) return
    let buf = new Float32Array(1024)
    const shown = Array.from({ length: rows }, () => MIN_DB)
    const hold = Array.from({ length: rows }, () => MIN_DB)
    const holdAt = Array.from({ length: rows }, () => 0)
    let last = performance.now()
    let drawn = ''
    let raf = 0
    let timer = 0

    // -12dB までは緑、-3dB までは黄、それより上は赤
    const colorOf = (db: number) => (db > -3 ? colors.high : db > -12 ? colors.mid : colors.low)
    const segs = Math.max(1, Math.floor((width + SEG_GAP) / (SEG_W + SEG_GAP)))
    const rowH = (height - ROW_GAP * (rows - 1)) / rows

    const peakOf = (a: AnalyserNode | undefined) => {
      if (!a) return MIN_DB
      if (buf.length !== a.fftSize) buf = new Float32Array(a.fftSize)
      a.getFloatTimeDomainData(buf)
      let m = 0
      for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]))
      return m > 0 ? 20 * Math.log10(m) : MIN_DB
    }

    const draw = () => {
      g.clearRect(0, 0, canvas.width, canvas.height)
      for (let r = 0; r < rows; r++) {
        const y = r * (rowH + ROW_GAP) * dpr
        const h = Math.max(1, rowH * dpr)
        const lit = toRatio(shown[r]) * segs
        const holdSeg = hold[r] > MIN_DB ? Math.min(segs - 1, Math.floor(toRatio(hold[r]) * segs)) : -1
        for (let s = 0; s < segs; s++) {
          const db = MIN_DB + ((s + 0.5) / segs) * -MIN_DB
          const on = s < lit || s === holdSeg
          // 点いていない区切りも薄く出して、目盛りの代わりにする
          g.fillStyle = on ? colorOf(db) : alpha(colorOf(db), 0.15)
          g.fillRect(s * (SEG_W + SEG_GAP) * dpr, y, SEG_W * dpr, h)
        }
      }
    }

    const frame = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const src = sourceRef.current()
      const list: readonly AnalyserNode[] = src ? (Array.isArray(src) ? src : [src as AnalyserNode]) : []
      for (let r = 0; r < rows; r++) {
        const peak = peakOf(list[r] ?? list[0])
        shown[r] = Math.max(peak, shown[r] - FALL_DB_PER_SEC * dt)
        if (shown[r] >= hold[r] || now - holdAt[r] > HOLD_SEC * 1000) {
          hold[r] = shown[r]
          holdAt[r] = now
        }
      }
      // 見た目が変わったときだけ描き直す
      const key = shown.map((v, r) => `${Math.floor(toRatio(v) * segs)}:${Math.floor(toRatio(hold[r]) * segs)}`).join('|')
      if (key !== drawn) {
        drawn = key
        draw()
      }
      // 鳴っていなくて表示も消えきったら、間隔をあけて確認する（再生が始まれば次の確認から毎フレームに戻る）
      if (!list.length && shown.every((v) => v <= MIN_DB) && hold.every((v) => v <= MIN_DB)) {
        timer = window.setTimeout(() => {
          last = performance.now()
          raf = requestAnimationFrame(frame)
        }, IDLE_MS)
      } else raf = requestAnimationFrame(frame)
    }
    draw()
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [rows, width, height, colors])

  return <canvas ref={ref} role="meter" aria-label={label} style={{ width, height, display: 'block' }} />
}

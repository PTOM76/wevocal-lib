// 音量のつまみとレベルメーターを一つにした部品と、パンの棒（トラックの欄。DAW によくある形。WeVocalSynth と WeVocal Studio で共通）
import { useLayoutEffect, useRef, useState } from 'react'
import { Box, Slider, Typography } from '@mui/material'
import { pevenFont, useDoubleClickReset } from 'pevenmui'
import ThemedLevelMeter from './ThemedLevelMeter'

const VOL_MIN = -60
const VOL_MAX = 12
/** 既定の高さ（px） */
const H = 14

/** 幅を測る（メーターの canvas の大きさに使う） */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/**
 * 音量のつまみ。溝にレベルメーターを描き、その上に細いつまみを重ねる。右に今の dB。ダブルクリックで 0 dB に戻す
 */
export function MeterFader(p: {
  value: number
  onChange: (db: number) => void
  onCommit: () => void
  meter?: () => AnalyserNode | readonly AnalyserNode[] | null
  rows?: number
  label: string
  /** 高さ（px。既定 14） */
  height?: number
}) {
  const h = p.height ?? H
  const [ref, w] = useWidth()
  // ダブルクリックで 0 dB に戻す（設定で切れる）
  const reset = useDoubleClickReset(() => p.onChange(0))
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box ref={ref} sx={{ position: 'relative', flex: 1, height: h, borderRadius: 0.5, bgcolor: 'action.hover', overflow: 'hidden' }} {...reset}>
        {p.meter && w > 0 && (
          <Box sx={{ position: 'absolute', inset: 0, opacity: 0.85 }}>
            <ThemedLevelMeter source={p.meter} rows={p.rows ?? 1} width={w} height={h} label={p.label} />
          </Box>
        )}
        <Slider
          min={VOL_MIN}
          max={VOL_MAX}
          step={0.1}
          value={p.value}
          onChange={(_, v) => p.onChange(v as number)}
          onChangeCommitted={p.onCommit}
          aria-label={p.label}
          sx={{
            position: 'absolute',
            inset: 0,
            p: 0,
            height: h,
            color: 'text.primary',
            '& .MuiSlider-rail, & .MuiSlider-track': { opacity: 0, border: 0 },
            // つまみは縦の細い棒（メーターが隠れないように）
            '& .MuiSlider-thumb': { width: 4, height: h, borderRadius: 0.5, boxShadow: 'none', '&::before': { boxShadow: 'none' } },
          }}
        />
      </Box>
      <Typography sx={{ width: 34, textAlign: 'right', fontSize: pevenFont('xs'), fontFamily: 'monospace', color: 'text.secondary' }}>
        {p.value <= VOL_MIN ? '-∞' : p.value.toFixed(1)}
      </Typography>
    </Box>
  )
}

/** パンの表記（C、L30、R30） */
const panText = (v: number) => (Math.abs(v) < 0.005 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`)

/** パン。真ん中から左右に色が伸びる細い棒。ドラッグで変え、ダブルクリックで真ん中に戻す */
export function PanBar(p: { value: number; onChange: (pan: number) => void; onCommit: () => void; label: string }) {
  const [ref, w] = useWidth()
  // ダブルクリックで真ん中に戻す（設定で切れる）
  const reset = useDoubleClickReset(() => p.onChange(0))
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1))
  }
  const half = w / 2
  const len = Math.abs(p.value) * half
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flex: 1, minWidth: 0 }}>
      <Box
        ref={ref}
        role="slider"
        aria-label={p.label}
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={p.value}
        onPointerDown={(e) => {
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          p.onChange(Math.round(at(e) * 100) / 100)
        }}
        onPointerMove={(e) => e.buttons && p.onChange(Math.round(at(e) * 100) / 100)}
        onPointerUp={p.onCommit}
        {...reset}
        sx={{ position: 'relative', flex: 1, height: 8, borderRadius: 0.5, bgcolor: 'action.hover', cursor: 'ew-resize', touchAction: 'none' }}
      >
        {/* 真ん中から伸びる色（左は左へ、右は右へ） */}
        <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: p.value < 0 ? half - len : half, width: len, bgcolor: 'secondary.main', borderRadius: 0.5 }} />
        <Box sx={{ position: 'absolute', top: -2, bottom: -2, left: half - 0.5, width: '1px', bgcolor: 'text.secondary' }} />
      </Box>
      <Typography sx={{ width: 34, textAlign: 'right', fontSize: pevenFont('xs'), fontFamily: 'monospace', color: 'text.secondary' }}>{panText(p.value)}</Typography>
    </Box>
  )
}

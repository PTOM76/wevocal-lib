// 音量メーターに、テーマの色と画面の倍率を渡したもの（WeVocalSynth と WeVocal Studio で共通。色は PevenMUI のテーマから）
import { useMemo, type ComponentProps } from 'react'
import { canvasPixelRatio, usePalette } from 'pevenmui'
import { LevelMeter } from './LevelMeter'

/** 音量メーター。色はテーマ（低い、中くらい、高いの順に success、warning、error）、解像度は画面の倍率から */
export default function ThemedLevelMeter(p: Omit<ComponentProps<typeof LevelMeter>, 'colors' | 'pixelRatio'>) {
  const { pal } = usePalette()
  const colors = useMemo(() => ({ low: pal.success.main, mid: pal.warning.main, high: pal.error.main }), [pal])
  return <LevelMeter {...p} colors={colors} pixelRatio={canvasPixelRatio} />
}

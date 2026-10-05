// 波形の表示の土台（React なし）: 表示範囲、ピーク、色、Canvas への基本の描画
export { timeToX, type View } from './view'
export { computePeaks, setPeaksOnBuild } from './peaks'
export { alpha, SELECTION_LIGHT, SELECTION_DARK, type WaveColors } from './colors'
export {
  RULER_HEIGHT,
  prepareCanvas,
  drawRuler,
  drawSelection,
  drawSelectionHandles,
  drawGhostWave,
  drawWave,
  drawPlayhead,
  type WaveDrawContext,
} from './draw'

import type { Clip, Range } from '../types'
import { encodeWav, type WavFormat } from '../wav'
import { prepareClip } from './prepare'

export type ExportFormat = 'wav' | 'mp3' | 'opus'

/** 書き出しの設定（書き出しダイアログで選ぶ） */
export interface ExportOptions {
  format: ExportFormat
  /** WAV のサンプル形式 */
  wavFormat: WavFormat
  /** MP3 / Opus のビットレート（kbps） */
  kbps: number
  /** 書き出すサンプルレート（Opus は常に 48kHz） */
  sampleRate: number
  mono: boolean
  /** null なら全体 */
  range: Range | null
}

export const EXPORT_EXT: Record<ExportFormat, string> = { wav: '.wav', mp3: '.mp3', opus: '.ogg' }

/** 設定に従って音声ファイルを作る */
export async function exportAudio(clip: Clip, o: ExportOptions, onProgress?: (p: number) => void): Promise<Blob> {
  const prepared = await prepareClip(clip, { range: o.range, sampleRate: o.sampleRate, mono: o.mono })
  if (o.format === 'wav') return encodeWav(prepared, o.wavFormat)
  // MP3 / Opus のエンコーダは使うときだけ読み込む
  if (o.format === 'mp3') return (await import('./mp3')).encodeMp3(prepared, o.kbps, onProgress)
  return (await import('./opus')).encodeOpus(prepared, o.kbps, onProgress)
}

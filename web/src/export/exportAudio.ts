import type { Clip, Range } from '../types'
import { encodeWav, type WavFormat } from '../wav'
import { prepareClip } from './prepare'

export type ExportFormat = 'wav' | 'flac' | 'mp3' | 'opus' | 'aac'

/** 書き出しの設定（書き出しダイアログで選ぶ） */
export interface ExportOptions {
  format: ExportFormat
  /** WAV のサンプル形式（FLAC は 16bit か 24bit。32bit float は 24bit にする） */
  wavFormat: WavFormat
  /** MP3 / Opus / AAC のビットレート（kbps） */
  kbps: number
  /** 書き出すサンプルレート（Opus は常に 48kHz） */
  sampleRate: number
  mono: boolean
  /** null なら全体 */
  range: Range | null
}

export const EXPORT_EXT: Record<ExportFormat, string> = { wav: '.wav', flac: '.flac', mp3: '.mp3', opus: '.ogg', aac: '.m4a' }
export const EXPORT_MIME: Record<ExportFormat, string> = { wav: 'audio/wav', flac: 'audio/flac', mp3: 'audio/mpeg', opus: 'audio/ogg', aac: 'audio/mp4' }

/** 設定に従って音声ファイルを作る */
export async function exportAudio(clip: Clip, o: ExportOptions, onProgress?: (p: number) => void): Promise<Blob> {
  const prepared = await prepareClip(clip, { range: o.range, sampleRate: o.sampleRate, mono: o.mono })
  if (o.format === 'wav') return encodeWav(prepared, o.wavFormat)
  // WAV 以外のエンコーダは使うときだけ読み込む
  if (o.format === 'flac') return (await import('./flac')).encodeFlac(prepared, o.wavFormat === 'pcm16' ? 16 : 24, onProgress)
  if (o.format === 'mp3') return (await import('./mp3')).encodeMp3(prepared, o.kbps, onProgress)
  if (o.format === 'aac') return (await import('./aac')).encodeAac(prepared, o.kbps, onProgress)
  return (await import('./opus')).encodeOpus(prepared, o.kbps, onProgress)
}

// 音声を MIDI の音符に並べるときの型（WeVocalSynth と WeVocal Studio で共通。並べ方はアプリごと）

/** 音符の長さへの合わせ方（stretch: 伸縮 / loop: 繰り返す / cut: そのまま、長ければ切る） */
export type FitMode = 'stretch' | 'loop' | 'cut'

export interface SamplerNote {
  note: number
  start: number
  end: number
}

// WeVocal プラグインの型（プラグインを作る人向け。アプリの側はこれを import する。逆向きの import はしない）

/** つまみ 1 つの定義 */
export interface ParamDef {
  id: string
  /** 訳文のキー */
  name: string
  min: number
  max: number
  default: number
  step?: number
  unit?: '%' | 'dB' | 'Hz' | 'ms' | 's' | ''
  /** 対数のつまみ（周波数など） */
  log?: boolean
  /** 選択肢（訳文のキー）。あれば値は index */
  choices?: string[]
}

/** プラグインのマニフェスト（共通） */
export interface PluginManifest {
  /** 例 'wevocal.reverb' */
  id: string
  /** プラグインの API の版 */
  api: 1
  /** 種類（今は fx だけ） */
  kind: 'fx'
  /** 中身の形式（今は wevocal だけ作る） */
  format: 'wevocal' | 'wam' | 'vst'
  version: string
  author: string
  /** 訳文のキー */
  name: string
  params: ParamDef[]
  /** 既定 true（false は書き出し専用） */
  realtime?: boolean
  /** 既定 true（先に計算してよいか） */
  anticipative?: boolean
  /** 遅れ（サンプル） */
  latency?: number
  /** 余韻の秒 */
  tail?: number
  presets?: { name: string; values: Record<string, number> }[]
  /** 古い param id → 新しい id */
  migrate?: Record<string, string>
}

/** 保存する形（トラックの fx の 1 項目） */
export interface FxSlot {
  /** manifest.id */
  plugin: string
  version: string
  on: boolean
  values: Record<string, number>
  /** つまみ以外の状態（base64）。今は使わない */
  state?: string
}

/** 実行中のプラグイン（wevocal-lib の LiveEffect と同じ形） */
export interface FxInstance {
  input: AudioNode
  output: AudioNode
  update(values: Record<string, number>): void
  /** オフは素通し（ノードは残す） */
  setOn(on: boolean): void
  dispose(): void
}

export interface HostInfo {
  /** 今のテンポ（BPM）。ディレイの同期に使う */
  bpm: () => number
}

/** 標準のプラグインの中身（今はノードを組む形） */
export interface FxPlugin {
  manifest: PluginManifest
  /** 'ja_jp' → { key: 訳 } */
  lang: Record<string, Record<string, string>>
  create(ctx: BaseAudioContext, values: Record<string, number>, host: HostInfo, on?: boolean): FxInstance
}

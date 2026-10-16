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
  kind: 'fx' | 'instrument'
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
  /** 二つ目の入力（サイドチェーン）を持つか。持つと、FX の列の項目で音を取る先のトラックを選べる */
  sidechain?: boolean
  /** 求める権限（導入のとき利用者に見せる。例 'network'）。今は宣言だけで、強制はしない */
  permissions?: string[]
  /** AudioWorklet で動くモジュールの場所（マニフェストからの相対）。registerProcessor する名前は processorName(id) */
  processor?: string
  /** processor に渡す wasm の場所（任意。processorOptions.wasm で受け取る） */
  wasm?: string
  /** 独自の画面の場所（マニフェストからの相対の HTML。iframe の sandbox の中に出す。無ければつまみから自動で作る） */
  ui?: string
  /** 訳文（ビルドの道具が lang/ の JSON をまとめて入れる。'ja_jp' → { key: 訳 }） */
  lang?: Record<string, Record<string, string>>
}

/** オートメーションの点（曲の頭からの秒と、つまみの値） */
export interface AutoPoint {
  t: number
  v: number
}

/** 保存する形（トラックの fx の 1 項目） */
export interface FxSlot {
  /** manifest.id */
  plugin: string
  version: string
  on: boolean
  values: Record<string, number>
  /** つまみ以外の状態（base64）。processor が port で知らせたものを保存し、次に作るときに渡す */
  state?: string
  /** オートメーション（つまみの id → 点。点の間は直線でつなぐ。選択肢のつまみは次の点まで保つ）。曲の時間で持つ */
  auto?: Record<string, AutoPoint[]>
  /** サイドチェーンで音を取るトラックの id（plugin が sidechain を持つとき。無ければ自分の入力で検出する） */
  sidechain?: string
}

/** 実行中のプラグイン（wevocal-lib の LiveEffect と同じ形） */
export interface FxInstance {
  input: AudioNode
  output: AudioNode
  /** 二つ目の入力（サイドチェーン）。持つプラグインだけ */
  sidechainIn?: AudioNode
  update(values: Record<string, number>): void
  /** 保存してあった状態を渡す（作ったあとに状態が変わったときのみ） */
  setState?(state: string | undefined): void
  /** オフは素通し（ノードは残す） */
  setOn(on: boolean): void
  dispose(): void
}

export interface HostInfo {
  /** 今のテンポ（BPM）。ディレイの同期に使う */
  bpm: () => number
  /** プラグインが状態（つまみ以外）を保存したいときに呼ぶ。ホストが FX の項目の state に入れる */
  onState?: (state: string) => void
}

/** 標準のプラグインの中身（今はノードを組む形） */
export interface FxPlugin {
  manifest: PluginManifest
  /** 値から余韻の秒を求める（manifest.tail の代わり。ディレイのフィードバックなど値で変わるもの） */
  tail?: (values: Record<string, number>, bpm: number) => number
  /** 'ja_jp' → { key: 訳 } */
  lang: Record<string, Record<string, string>>
  /** 独自の画面の HTML（manifest.ui を読んだもの） */
  ui?: string
  /** 使う前に済ませる非同期の準備（processor の読み込み）。書き出しの前に呼ぶ */
  preload?: (ctx: BaseAudioContext) => Promise<void>
  create(ctx: BaseAudioContext, values: Record<string, number>, host: HostInfo, on?: boolean, state?: string): FxInstance
}

/** processor が registerProcessor する名前（id から決める。例 'my.reverb' → 'wevocal-fx-my-reverb'） */
export const processorName = (id: string) => `wevocal-fx-${id.replace(/[^a-zA-Z0-9]/g, '-')}`

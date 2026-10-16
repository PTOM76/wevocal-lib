// WeVocal プラグインのホスト。標準のプラグインの一覧と、FX の列（トラックに掛けるエフェクトを順につなぐ）
import { compressorPlugin } from './compressor'
import { deesserPlugin } from './deesser'
import { delayPlugin } from './delay'
import { filterPlugin } from './filter'
import { distortionPlugin } from './distortion'
import { chorusPlugin, ensemblePlugin } from './ensemble'
import { eqPlugin } from './eq'
import { gatePlugin } from './gate'
import { limiterPlugin } from './limiter'
import { reverbPlugin } from './reverb'
import { installedPlugins, pluginsVersion } from './registry'
import { templatePlugin } from '../../../plugin-sdk/template'
import type { FxInstance, FxPlugin, FxSlot, HostInfo, PluginManifest } from '../../../plugin-sdk'

/** アプリに同梱する標準のプラグイン（段階が進むと増える） */
export const STANDARD_PLUGINS: FxPlugin[] = [eqPlugin, gatePlugin, compressorPlugin, deesserPlugin, filterPlugin, distortionPlugin, delayPlugin, reverbPlugin, chorusPlugin, ensemblePlugin, limiterPlugin]
/** 開発者向けの設定でだけ出すプラグイン（雛形） */
export const DEV_PLUGINS: FxPlugin[] = [templatePlugin]

/** 追加の一覧に出すプラグイン（標準と、導入したもの） */
export const availablePlugins = (): FxPlugin[] => [...STANDARD_PLUGINS, ...installedPlugins()]

export const findPlugin = (id: string): FxPlugin | undefined => [...STANDARD_PLUGINS, ...DEV_PLUGINS, ...installedPlugins()].find((p) => p.manifest.id === id)

/** 列の中の導入したプラグインの準備（processor の読み込み）を済ませる。書き出しの前と再生の前に待つ */
export async function preloadFx(ctx: BaseAudioContext, ...lists: (FxSlot[] | undefined)[]): Promise<void> {
  const ids = new Set(lists.flatMap((l) => (l ?? []).map((s) => s.plugin)))
  await Promise.all([...ids].map((id) => findPlugin(id)?.preload?.(ctx)))
}

export const defaultValues = (m: PluginManifest): Record<string, number> => Object.fromEntries(m.params.map((p) => [p.id, p.default]))

/** 古い param id を新しい id に読み替える。読み替えられない値も捨てずに残す */
export function migrateValues(m: PluginManifest, values: Record<string, number>): Record<string, number> {
  const map = m.migrate ?? {}
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [map[k] ?? k, v]))
}

/** 入っていないプラグインの id（列の中から。重複は除く）。プロジェクトを開いたときに導入を勧めるために使う */
export function missingPlugins(...lists: (FxSlot[] | undefined)[]): string[] {
  return [...new Set(lists.flatMap((l) => (l ?? []).map((s) => s.plugin)))].filter((id) => !findPlugin(id))
}

/** 新しい項目（既定の値、オン） */
export const newSlot = (p: FxPlugin): FxSlot => ({ plugin: p.manifest.id, version: p.manifest.version, on: true, values: defaultValues(p.manifest) })

/** 全部オフか空（トラックの FX ボタンの色に使う） */
export const isNeutralChain = (slots: FxSlot[] | undefined) => !slots?.some((s) => s.on)

/** 訳文を引く。アプリの言語 → en_us → キーそのもの */
export function fxText(p: Pick<FxPlugin, 'lang'>, key: string, lang: string): string {
  return p.lang[lang]?.[key] ?? p.lang.en_us?.[key] ?? key
}

/** オンのプラグインの余韻の最大（秒）。値で変わるもの（ディレイ）は値から求める */
export const chainTail = (slots: FxSlot[] | undefined, bpm = 120) =>
  Math.max(
    0,
    ...(slots ?? [])
      .filter((s) => s.on)
      .map((s) => {
        const p = findPlugin(s.plugin)
        return p?.tail ? p.tail(s.values, bpm) : (p?.manifest.tail ?? 0)
      }),
  )

/** オンのプラグインの遅れの合計（秒）。manifest.latency（サンプル）を足す */
export const chainLatency = (slots: FxSlot[] | undefined, sampleRate: number) =>
  (slots ?? []).filter((s) => s.on).reduce((sum, s) => sum + (findPlugin(s.plugin)?.manifest.latency ?? 0), 0) / sampleRate

export interface FxChain {
  input: AudioNode
  output: AudioNode
  /** 同じ並びなら値だけを変える。並びや数が変わったら作り直す（input と output は同じまま） */
  update(slots: FxSlot[]): void
  dispose(): void
}

/** 項目の並びの識別（プラグインの id の列と、導入したプラグインの版。導入や削除があれば作り直す） */
const shape = (slots: FxSlot[]) => `${pluginsVersion()}|${slots.map((s) => s.plugin).join(',')}`

export function createFxChain(ctx: BaseAudioContext, slots: FxSlot[], host: HostInfo): FxChain {
  const input = ctx.createGain()
  const output = ctx.createGain()
  let current: (FxInstance | null)[] = []
  let key = ''

  const build = (list: FxSlot[]) => {
    input.disconnect()
    // 見つからないプラグイン（入っていない）は素通し。値は slots に残る
    current = list.map((s) => {
      const pl = findPlugin(s.plugin)
      // 書き出し専用（realtime: false）は、再生中は通さず素通しにする。書き出し（OfflineAudioContext）では掛ける
      if (pl?.manifest.realtime === false && ctx instanceof AudioContext) return null
      return pl?.create(ctx, migrateValues(pl.manifest, s.values), host, s.on) ?? null
    })
    let last: AudioNode = input
    for (const n of current) {
      if (!n) continue
      last.connect(n.input)
      last = n.output
    }
    last.connect(output)
    key = shape(list)
  }
  const free = () => {
    for (const n of current) n?.dispose()
    current = []
  }
  build(slots)

  return {
    input,
    output,
    update(list) {
      if (shape(list) !== key) {
        free()
        build(list)
        return
      }
      for (const [i, n] of current.entries()) {
        if (!n) continue
        n.update(migrateValues(findPlugin(list[i].plugin)!.manifest, list[i].values))
        n.setOn(list[i].on)
      }
    },
    dispose() {
      free()
      input.disconnect()
      output.disconnect()
    },
  }
}

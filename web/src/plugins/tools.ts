// 解析と編集の道具のプラグイン（kind: 'analyzer'、'tool'）。選んだ音を受け取って、解析なら結果の一覧を返し、道具なら加工した音を返す。標準のものと、外から足すもの
import { type PluginPackage } from './external'
import type { PluginManifest } from '../../../plugin-sdk'

/** 道具に渡す音（チャンネルごとのサンプル） */
export interface ToolInput {
  channels: Float32Array[]
  sampleRate: number
}

/** 解析の結果 1 行（key はプラグインの訳文のキー） */
export interface ToolRow {
  key: string
  value: number | string
  unit?: string
}

/** 道具の結果。道具は加工した音（長さは変えてよい）、解析は結果の一覧 */
export interface ToolResult {
  channels?: Float32Array[]
  rows?: ToolRow[]
}

export interface ToolPlugin {
  manifest: PluginManifest
  /** 'ja_jp' → { key: 訳 } */
  lang: Record<string, Record<string, string>>
  /** 標準のものは関数。外から足したものは pkg の processor を Worker で動かす */
  run?: (input: ToolInput, values: Record<string, number>) => ToolResult | Promise<ToolResult>
  pkg?: PluginPackage
}

/** 導入した道具（store.ts が入れる） */
let installed: ToolPlugin[] = []
export const setInstalledTools = (list: ToolPlugin[]) => void (installed = list)
export const installedTools = () => installed

let standard: ToolPlugin[] = []
/** 標準の道具を登録する（toolsStandard.ts が読み込まれたとき） */
export const registerStandardTools = (list: ToolPlugin[]) => void (standard = list)

/** 種類（'tool' か 'analyzer'）の道具の一覧（標準と導入したもの） */
export const availableTools = (kind: 'tool' | 'analyzer'): ToolPlugin[] => [...standard, ...installed].filter((p) => p.manifest.kind === kind)
export const findTool = (id: string) => [...standard, ...installed].find((p) => p.manifest.id === id)

/**
 * 外から足した道具を、Worker の中で動かす。processor のソースは classic script で、registerTool(fn) を呼ぶ（fn は (input, values) => 結果）。
 * Worker にはアプリの中の物が見えないので、アプリから隔離される（音と値だけをやり取りする）
 */
function runInWorker(pkg: PluginPackage, input: ToolInput, values: Record<string, number>): Promise<ToolResult> {
  const code = `let __fn\nfunction registerTool(f) { __fn = f }\n${pkg.processor}\nself.onmessage = async (e) => {\n  try {\n    const r = await __fn(e.data.input, e.data.values)\n    self.postMessage({ ok: true, r })\n  } catch (err) {\n    self.postMessage({ ok: false, error: String(err) })\n  }\n}`
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  const worker = new Worker(url)
  return new Promise<ToolResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ ok: boolean; r?: ToolResult; error?: string }>) => (e.data.ok ? resolve(e.data.r ?? {}) : reject(new Error(e.data.error)))
    worker.onerror = (e) => reject(new Error(e.message))
    worker.postMessage({ input, values })
  }).finally(() => {
    worker.terminate()
    URL.revokeObjectURL(url)
  })
}

/** 道具か解析を実行する。道具は結果の音のチャンネルが空でなければならない */
export async function runTool(plugin: ToolPlugin, input: ToolInput, values: Record<string, number>): Promise<ToolResult> {
  const r = plugin.run ? await plugin.run(input, values) : plugin.pkg ? await runInWorker(plugin.pkg, input, values) : {}
  if (plugin.manifest.kind === 'tool' && !r.channels?.length) throw new Error('the tool returned no audio')
  return r
}

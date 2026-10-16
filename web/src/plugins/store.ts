// プラグインの導入と保存。URL から取得して、置き場（PevenMUI の createPackageStore。Cache Storage と、選んだフォルダー）に置く。ネットが無くても使える
import { makeExternalPlugin, type PluginPackage } from './external'
import { setInstalledPlugins } from './registry'
import { PluginError, validateManifest } from './validate'
import type { FxPlugin } from '../../../plugin-sdk'

/** プラグインの置き場（PevenMUI の PackageStore と同じ形。wevocal-lib の本体は PevenMUI に依存しないので、アプリが setPluginStore で渡す） */
export interface PluginStore {
  put(id: string, files: Record<string, string | ArrayBuffer>): Promise<void>
  get(id: string, path: string): Promise<ArrayBuffer | null>
  getText(id: string, path: string): Promise<string | null>
  ids(): Promise<string[]>
  remove(id: string): Promise<void>
}

let store: PluginStore | null = null

/** 置き場を決める（アプリの起動時に、loadInstalledPlugins より先に呼ぶ） */
export function setPluginStore(s: PluginStore) {
  store = s
}

/** 取得して中身を返す。失敗は PluginError('fetch') */
async function get(url: URL): Promise<Response> {
  const res = await fetch(url).catch(() => null)
  if (!res?.ok) throw new PluginError('fetch')
  return res
}

/** マニフェストの URL から取得する（processor と wasm は、マニフェストからの相対の場所） */
export async function fetchPackage(url: string): Promise<PluginPackage> {
  const base = new URL(url, location.href)
  const json: unknown = await (await get(base)).json().catch(() => {
    throw new PluginError('manifest')
  })
  const manifest = validateManifest(json)
  if (!manifest.processor) throw new PluginError('processor')
  const processor = await (await get(new URL(manifest.processor, base))).text()
  const wasm = manifest.wasm ? await (await get(new URL(manifest.wasm, base))).arrayBuffer() : undefined
  const ui = manifest.ui ? await (await get(new URL(manifest.ui, base))).text() : undefined
  return { manifest, processor, wasm, ui, source: base.href }
}

/** 導入する（同じ id は置き換える） */
export async function installPackage(pkg: PluginPackage): Promise<void> {
  if (!store) throw new PluginError('fetch')
  const files: Record<string, string | ArrayBuffer> = { 'manifest.json': JSON.stringify(pkg.manifest), 'processor.js': pkg.processor }
  if (pkg.wasm) files['module.wasm'] = pkg.wasm
  if (pkg.ui) files['ui.html'] = pkg.ui
  if (pkg.source) files['source.txt'] = pkg.source
  await store.put(pkg.manifest.id, files)
  await loadInstalledPlugins()
}

/** 削除する */
export async function removePlugin(id: string): Promise<void> {
  await store?.remove(id)
  await loadInstalledPlugins()
}

/** 取得元の URL（更新に使う。直接足したものなど、無ければ null） */
export async function pluginSource(id: string): Promise<string | null> {
  return (await store?.getText(id, 'source.txt')) ?? null
}

/** 更新を確かめて、版が違えば入れ替える。'updated'、'same'、'none'（取得元が分からない）を返す。取得できなければ PluginError */
export async function updatePlugin(id: string): Promise<'updated' | 'same' | 'none'> {
  const source = await pluginSource(id)
  if (!source) return 'none'
  const pkg = await fetchPackage(source)
  if (pkg.manifest.id !== id) throw new PluginError('id')
  const current = (await store?.getText(id, 'manifest.json').then((t) => (t ? validateManifest(JSON.parse(t)) : null)).catch(() => null))?.version
  if (current === pkg.manifest.version) return 'same'
  await installPackage(pkg)
  return 'updated'
}

/** 最初の読み込み（起動時）。これを待てば、導入済みのプラグインが findPlugin で見つかる */
let first: Promise<void> | null = null
export const whenPluginsLoaded = () => first ?? Promise.resolve()

/** 導入済みを読んで登録簿に入れる（起動時と、導入、削除のあと） */
export function loadInstalledPlugins(): Promise<void> {
  const p = readInstalled()
  first ??= p
  return p
}

async function readInstalled(): Promise<void> {
  if (!store) return
  const list: FxPlugin[] = []
  for (const id of await store.ids().catch(() => [])) {
    try {
      const text = await store.getText(id, 'manifest.json')
      const processor = await store.getText(id, 'processor.js')
      if (!text || !processor) continue
      const manifest = validateManifest(JSON.parse(text))
      const wasm = (await store.get(id, 'module.wasm')) ?? undefined
      const ui = manifest.ui ? ((await store.getText(id, 'ui.html')) ?? undefined) : undefined
      list.push(makeExternalPlugin({ manifest, processor, wasm, ui }))
    } catch {
      // 壊れたものは飛ばす
    }
  }
  setInstalledPlugins(list.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)))
}

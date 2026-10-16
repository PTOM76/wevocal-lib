// プラグインの導入と保存（URL から取得してキャッシュ（Cache Storage）に置く。ネットが無くても使える）
import { makeExternalPlugin, type PluginPackage } from './external'
import { setInstalledPlugins } from './registry'
import { PluginError, validateManifest } from './validate'
import type { FxPlugin } from '../../../plugin-sdk'

const CACHE = 'wevocal-plugins'
/** キャッシュ内の仮の住所（実在しない。id ごとに manifest.json、processor.js、module.wasm を置く） */
const key = (id: string, file: string) => `https://plugins.wevocal.invalid/${encodeURIComponent(id)}/${file}`

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
  return { manifest, processor, wasm }
}

/** 導入する（同じ id は置き換える） */
export async function installPackage(pkg: PluginPackage): Promise<void> {
  const cache = await caches.open(CACHE)
  const id = pkg.manifest.id
  await cache.put(key(id, 'manifest.json'), new Response(JSON.stringify(pkg.manifest), { headers: { 'content-type': 'application/json' } }))
  await cache.put(key(id, 'processor.js'), new Response(pkg.processor, { headers: { 'content-type': 'text/javascript' } }))
  if (pkg.wasm) await cache.put(key(id, 'module.wasm'), new Response(pkg.wasm))
  else await cache.delete(key(id, 'module.wasm'))
  await loadInstalledPlugins()
}

/** 削除する */
export async function removePlugin(id: string): Promise<void> {
  const cache = await caches.open(CACHE)
  for (const f of ['manifest.json', 'processor.js', 'module.wasm']) await cache.delete(key(id, f))
  await loadInstalledPlugins()
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
  if (typeof caches === 'undefined') return
  const cache = await caches.open(CACHE)
  const list: FxPlugin[] = []
  for (const req of await cache.keys()) {
    if (!req.url.endsWith('/manifest.json')) continue
    try {
      const manifest = validateManifest(await (await cache.match(req))!.json())
      const processor = await (await cache.match(key(manifest.id, 'processor.js')))?.text()
      if (!processor) continue
      const wasm = await (await cache.match(key(manifest.id, 'module.wasm')))?.arrayBuffer()
      list.push(makeExternalPlugin({ manifest, processor, wasm }))
    } catch {
      // 壊れたものは飛ばす
    }
  }
  setInstalledPlugins(list.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)))
}

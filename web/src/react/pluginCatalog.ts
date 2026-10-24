// プラグインのカタログ（一覧の JSON）の読み込みと、カタログの項目から導入する包みを作る処理（PluginManager と MissingPluginsDialog で共通）
import { useEffect, useState } from 'react'
import { fetchPackage, PluginError, vstPackageFromUrl, wamPackageFromUrl, type PluginPackage } from '../plugins'

export interface CatalogPlugin {
  id: string
  /** 元のカタログでの id（大文字と小文字をそろえる前） */
  sourceId?: string
  name: string
  author: string
  version?: string
  description: string
  type: 'wam' | 'manifest' | 'vst'
  url: string
  website: string
  categories: string[]
  keywords: string[]
  installable: boolean
}

export function parseCatalog(raw: unknown): CatalogPlugin[] {
  if (!raw || typeof raw !== 'object' || !('version' in raw) || raw.version !== 1 || !('plugins' in raw) || !Array.isArray(raw.plugins)) {
    throw new Error('Unsupported plugin catalog format')
  }
  return raw.plugins.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid plugin catalog entry')
    const entry = item as Record<string, unknown>
    if (
      typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.author !== 'string' ||
      typeof entry.description !== 'string' || typeof entry.url !== 'string' ||
      (entry.type !== 'wam' && entry.type !== 'manifest' && entry.type !== 'vst') ||
      typeof entry.installable !== 'boolean' ||
      !Array.isArray(entry.categories) || !entry.categories.every((value) => typeof value === 'string') ||
      !Array.isArray(entry.keywords) || !entry.keywords.every((value) => typeof value === 'string')
    ) {
      throw new Error('Invalid plugin catalog entry')
    }
    const url = new URL(entry.url)
    if (url.protocol !== 'https:') throw new Error('Plugin catalog URLs must use HTTPS')
    return {
      id: entry.id,
      ...(typeof entry.sourceId === 'string' ? { sourceId: entry.sourceId } : {}),
      name: entry.name,
      author: entry.author,
      ...(typeof entry.version === 'string' ? { version: entry.version } : {}),
      description: entry.description,
      type: entry.type,
      url: url.href,
      website: typeof entry.website === 'string' ? entry.website : '',
      categories: entry.categories,
      keywords: entry.keywords,
      installable: entry.installable,
    }
  })
}

/** カタログを読み込む（url が無ければ読み込まない） */
export function useCatalog(url: string | undefined) {
  const [catalog, setCatalog] = useState<CatalogPlugin[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(url ? 'loading' : 'ready')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!url) {
      setStatus('ready')
      return
    }
    const controller = new AbortController()
    setStatus('loading')
    setError('')
    void fetch(url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setCatalog(parseCatalog(await response.json()))
      setStatus('ready')
    }).catch((e: unknown) => {
      if (controller.signal.aborted) return
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    })
    return () => controller.abort()
  }, [url])
  return { catalog, status, error }
}

/** カタログの項目が導入できるか（VST は試験的機能がオンのときだけ） */
export function canInstall(entry: CatalogPlugin, vst?: boolean) {
  return entry.installable && (entry.type !== 'vst' || !!vst)
}

/** カタログの項目から、導入する包みを取ってくる */
export async function catalogPackage(entry: CatalogPlugin, vst?: boolean): Promise<PluginPackage> {
  if (entry.type === 'wam') return wamPackageFromUrl(entry.url)
  if (entry.type === 'manifest') return fetchPackage(entry.url)
  if (!vst) throw new PluginError('vst')
  return vstPackageFromUrl(entry.url)
}

/** プロジェクトが使うプラグインの id に当たるカタログの項目（大文字と小文字は区別しない） */
export function findCatalogEntry(catalog: CatalogPlugin[], id: string) {
  const key = id.toLowerCase()
  return catalog.find((entry) => entry.id.toLowerCase() === key || entry.sourceId?.toLowerCase() === key)
}

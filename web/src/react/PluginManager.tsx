// プラグインの導入と管理の画面（設定の「プラグイン」の中身。WeVocalSynth と WeVocal Studio で共通。訳文はアプリの t を渡す）
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Box, Button, DialogActions, DialogContent, IconButton, Tab, Tabs, TextField, Typography } from '@mui/material'
import { WindowDialog, pevenFont } from 'pevenmui'
import { fetchPackage, fxText, installPackage, installedInstruments, installedPlugins, installedTools, PluginError, pluginSource, pluginsVersion, removePlugin, subscribePlugins, updatePlugin, vstPackageFromFile, vstPackageFromUrl, wamPackageFromUrl, type PluginPackage } from '../plugins'

/** この画面が使う訳文のキー（アプリの訳文に同じキーを置く） */
export type PluginManagerKey =
  | 'plugins.intro' | 'plugins.url' | 'plugins.add' | 'plugins.empty' | 'plugins.remove' | 'plugins.confirmTitle' | 'plugins.author' | 'plugins.version' | 'plugins.permissions'
  | 'plugins.permissionsNone' | 'plugins.notice' | 'plugins.install' | 'plugins.cancel' | 'plugins.replace' | 'plugins.update' | 'plugins.updated' | 'plugins.upToDate' | 'plugins.noSource'
  | 'plugins.vst.pick' | 'plugins.vst.notice' | 'plugins.vst.warning' | 'plugins.vst.load' | 'plugins.vst.loadHeavy' | 'plugins.error.fetch' | 'plugins.error.vst' | 'plugins.error.wam' | 'plugins.error.manifest' | 'plugins.error.api' | 'plugins.error.kind' | 'plugins.error.format' | 'plugins.error.id' | 'plugins.error.processor' | 'plugins.error.reserved'
  | 'plugins.warning.folderOnly'

export type PluginManagerCatalogKey =
  | 'plugins.catalog' | 'plugins.catalog.search' | 'plugins.catalog.loading' | 'plugins.catalog.error' | 'plugins.catalog.empty' | 'plugins.catalog.unsupported' | 'plugins.catalog.installed' | 'plugins.catalog.source'

interface CatalogPlugin {
  id: string
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

function parseCatalog(raw: unknown): CatalogPlugin[] {
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

function httpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

/** エラーを画面の文にする（VST の読み込みの失敗は、理由の詳細を添える） */
function errorText(t: (key: PluginManagerKey) => string, e: unknown) {
  const base = t(`plugins.error.${e instanceof PluginError ? e.code : 'fetch'}` as PluginManagerKey)
  if (e instanceof PluginError && e.detail) return `${base}（${e.detail}）`
  return e instanceof Error && e.message ? e.message : base
}

type PluginManagerProps = {
  t: (key: PluginManagerKey, vars?: Record<string, string | number>) => string
  lang: string
  /** 試験的機能の VST（DLL をエミュレーターで動かす）の入口を出すか */
  vst?: boolean
} & (
  | { registryUrl: string; catalogText: (key: PluginManagerCatalogKey) => string }
  | { registryUrl?: undefined; catalogText?: undefined }
)

export default function PluginManager(p: PluginManagerProps) {
  const t = p.t
  const ct = (key: PluginManagerCatalogKey) => p.catalogText?.(key) ?? key
  const pluginVersion = useSyncExternalStore(subscribePlugins, pluginsVersion)
  // 導入したもの（エフェクトと音源）
  const list = [...installedPlugins(), ...installedInstruments(), ...installedTools()]
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [tab, setTab] = useState<'catalog' | 'installed'>(p.registryUrl ? 'catalog' : 'installed')
  const [catalog, setCatalog] = useState<CatalogPlugin[]>([])
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>(p.registryUrl ? 'loading' : 'ready')
  const [catalogError, setCatalogError] = useState('')
  const [catalogQuery, setCatalogQuery] = useState('')
  const [installedSources, setInstalledSources] = useState<Set<string>>(() => new Set())
  // 確かめている途中のもの（導入を押すまで保存しない）
  // 更新の結果の表示（id ごと）
  const [updated, setUpdated] = useState<Record<string, string>>({})
  const update = async (id: string) => {
    setUpdated((u) => ({ ...u, [id]: '…' }))
    try {
      const r = await updatePlugin(id)
      setUpdated((u) => ({ ...u, [id]: t(r === 'updated' ? 'plugins.updated' : r === 'same' ? 'plugins.upToDate' : 'plugins.noSource') }))
    } catch (e) {
      setUpdated((u) => ({ ...u, [id]: errorText(t, e) }))
    }
  }
  const [pending, setPending] = useState<PluginPackage | null>(null)

  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let active = true
    void Promise.all(list.map((plugin) => pluginSource(plugin.manifest.id))).then((sources) => {
      if (active) setInstalledSources(new Set(sources.filter((source): source is string => source !== null)))
    }).catch((e: unknown) => {
      if (active) console.error('Failed to read installed plugin sources', e)
    })
    return () => {
      active = false
    }
  }, [pluginVersion])

  useEffect(() => {
    if (!p.registryUrl) {
      setCatalogStatus('ready')
      return
    }
    const controller = new AbortController()
    setCatalogStatus('loading')
    setCatalogError('')
    void fetch(p.registryUrl, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setCatalog(parseCatalog(await response.json()))
      setCatalogStatus('ready')
    }).catch((e: unknown) => {
      if (controller.signal.aborted) return
      setCatalogError(e instanceof Error ? e.message : String(e))
      setCatalogStatus('error')
    })
    return () => controller.abort()
  }, [p.registryUrl])

  const fetchIt = async () => {
    setBusy(true)
    setError('')
    setWarning('')
    try {
      const u = url.trim()
      // .dll で終わる URL は VST として取り込む（試験的機能がオンのとき）
      // .js で終わる URL は WebAudio Modules として取り込む
      setPending(p.vst && /\.dll(\?.*)?$/i.test(u) ? await vstPackageFromUrl(u) : /\.m?js(\?.*)?$/i.test(u) ? await wamPackageFromUrl(u) : await fetchPackage(u))
    } catch (e) {
      setError(errorText(t, e))
    } finally {
      setBusy(false)
    }
  }
  /** DLL のファイルを選んだとき */
  const pickDll = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError('')
    setWarning('')
    try {
      setPending(await vstPackageFromFile(file))
    } catch (e) {
      setError(errorText(t, e))
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }
  const installFromCatalog = async (entry: CatalogPlugin) => {
    setBusy(true)
    setError('')
    setWarning('')
    try {
      const pkg = entry.type === 'wam'
        ? await wamPackageFromUrl(entry.url)
        : entry.type === 'manifest'
          ? await fetchPackage(entry.url)
          : p.vst
            ? await vstPackageFromUrl(entry.url)
            : null
      if (!pkg) throw new PluginError('vst')
      setPending(pkg)
    } catch (e) {
      setError(errorText(t, e))
    } finally {
      setBusy(false)
    }
  }
  const install = async () => {
    if (!pending) return
    setBusy(true)
    setError('')
    setWarning('')
    try {
      const cached = await installPackage(pending)
      if (!cached) setWarning(t('plugins.warning.folderOnly'))
      setPending(null)
      setUrl('')
    } catch (e) {
      setError(errorText(t, e))
    } finally {
      setBusy(false)
    }
  }
  const pm = pending?.manifest
  const filteredCatalog = catalog.filter((entry) => `${entry.name} ${entry.author} ${entry.description} ${entry.categories.join(' ')} ${entry.keywords.join(' ')}`.toLocaleLowerCase().includes(catalogQuery.trim().toLocaleLowerCase()))

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('plugins.intro')}</Typography>
      {p.registryUrl && (
        <Tabs value={tab} onChange={(_, value: 'catalog' | 'installed') => setTab(value)} variant="fullWidth">
          <Tab value="catalog" label={`${ct('plugins.catalog')} (${catalog.length})`} />
          <Tab value="installed" label={`${ct('plugins.catalog.installed')} (${list.length})`} />
        </Tabs>
      )}
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField size="small" fullWidth value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('plugins.url')} error={!!error} helperText={error || undefined} />
        <Button size="small" disabled={busy || !url.trim()} onClick={() => void fetchIt()} sx={{ flexShrink: 0, alignSelf: 'flex-start', height: 40 }}>
          {t('plugins.add')}
        </Button>
      </Box>
      {p.vst && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <input ref={fileInput} type="file" accept=".dll" hidden onChange={(e) => void pickDll(e.target.files?.[0])} />
          <Button size="small" disabled={busy} onClick={() => fileInput.current?.click()}>
            {t('plugins.vst.pick')}
          </Button>
          <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('plugins.vst.notice')}</Typography>
        </Box>
      )}
      {warning && <Typography sx={{ fontSize: pevenFont('sm'), color: 'warning.main' }}>{warning}</Typography>}
      {(!p.registryUrl || tab === 'installed') && (
        <>
          {!list.length && <Typography sx={{ fontSize: pevenFont('base'), color: 'text.secondary' }}>{t('plugins.empty')}</Typography>}
          {list.map((pl) => (
            <Box key={pl.manifest.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: pevenFont('base') }}>
                  {fxText(pl, 'name', p.lang)}
                </Typography>
                <Typography noWrap sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>
                  {pl.manifest.id} · {pl.manifest.version} · {pl.manifest.author}
                </Typography>
              </Box>
              {updated[pl.manifest.id] && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{updated[pl.manifest.id]}</Typography>}
              <Button size="small" disabled={busy} onClick={() => void update(pl.manifest.id)}>
                {t('plugins.update')}
              </Button>
              <IconButton size="small" aria-label={t('plugins.remove')} title={t('plugins.remove')} disabled={busy} onClick={() => void removePlugin(pl.manifest.id)}>
                ×
              </IconButton>
            </Box>
          ))}
        </>
      )}
      {p.registryUrl && tab === 'catalog' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <TextField size="small" value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder={ct('plugins.catalog.search')} />
          {catalogStatus === 'loading' && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{ct('plugins.catalog.loading')}</Typography>}
          {catalogStatus === 'error' && <Typography role="alert" sx={{ fontSize: pevenFont('sm'), color: 'error.main' }}>{ct('plugins.catalog.error')}: {catalogError}</Typography>}
          {catalogStatus === 'ready' && filteredCatalog.map((entry) => {
            const installed = installedSources.has(entry.url)
            const canInstall = entry.installable && (entry.type !== 'vst' || p.vst)
            const websiteUrl = httpsUrl(entry.website)
            return (
              <Box key={entry.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider', py: 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: pevenFont('base') }}>{entry.name}</Typography>
                  <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }} noWrap>
                    {entry.author}{entry.version ? ` · ${entry.version}` : ''} · {entry.categories.join(', ') || entry.type.toUpperCase()}
                  </Typography>
                  {entry.description && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{entry.description}</Typography>}
                </Box>
                {websiteUrl && <Button size="small" component="a" href={websiteUrl} target="_blank" rel="noopener noreferrer">{ct('plugins.catalog.source')}</Button>}
                {installed
                  ? <Typography sx={{ fontSize: pevenFont('sm'), color: 'success.main' }}>{ct('plugins.catalog.installed')}</Typography>
                  : canInstall
                    ? <Button size="small" disabled={busy} onClick={() => void installFromCatalog(entry)}>{t('plugins.install')}</Button>
                    : <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{ct('plugins.catalog.unsupported')}</Typography>}
              </Box>
            )
          })}
          {catalogStatus === 'ready' && !filteredCatalog.length && (
            <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{ct('plugins.catalog.empty')}</Typography>
          )}
        </Box>
      )}
      {/* 設定に従って、別の窓（ポップアップ）にも出せる（PevenMUI の WindowDialog） */}
      <WindowDialog open={!!pm} onClose={() => setPending(null)} title={t('plugins.confirmTitle')} name="pluginConfirm" width={460} height={520} dialogProps={{ fullWidth: true, maxWidth: 'xs' }}>
        <DialogContent>
          {pm && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Typography sx={{ fontSize: pevenFont('lg') }}>{fxText({ lang: pm.lang ?? {} }, 'name', p.lang)}</Typography>
              <Typography sx={{ fontSize: pevenFont('base') }}>
                {t('plugins.author')}: {pm.author}
              </Typography>
              <Typography sx={{ fontSize: pevenFont('base') }}>
                {t('plugins.version')}: {pm.version}（{pm.id}）
              </Typography>
              <Typography sx={{ fontSize: pevenFont('base') }}>
                {t('plugins.permissions')}: {pm.permissions?.length ? pm.permissions.join(', ') : t('plugins.permissionsNone')}
              </Typography>
              {/* VST: 動かないかもしれない注意と、重さの目安 */}
              {pm.format === 'vst' && <Typography sx={{ fontSize: pevenFont('sm'), color: 'warning.main', mt: 1 }}>{t('plugins.vst.warning')}</Typography>}
              {pm.format === 'vst' && pending?.load !== undefined && (
                <Typography sx={{ fontSize: pevenFont('sm'), color: pending.load >= 1 ? 'warning.main' : 'text.secondary' }}>
                  {t(pending.load >= 1 ? 'plugins.vst.loadHeavy' : 'plugins.vst.load', { n: Math.max(1, Math.round(pending.load * 100)) })}
                </Typography>
              )}
              {installedPlugins().some((x) => x.manifest.id === pm.id) && <Typography sx={{ fontSize: pevenFont('sm'), color: 'warning.main' }}>{t('plugins.replace')}</Typography>}
              <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary', mt: 1 }}>{t('plugins.notice')}</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setPending(null)}>
            {t('plugins.cancel')}
          </Button>
          <Button size="small" disabled={busy} onClick={() => void install()}>
            {t('plugins.install')}
          </Button>
        </DialogActions>
      </WindowDialog>
    </Box>
  )
}

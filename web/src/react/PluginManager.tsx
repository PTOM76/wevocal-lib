// プラグインの導入と管理の画面（設定の「プラグイン」の中身。WeVocalSynth と WeVocal Studio で共通。訳文はアプリの t を渡す）
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Box, Button, IconButton, Tab, Tabs, TextField, Typography } from '@mui/material'
import { pevenFont } from 'pevenmui'
import { fetchPackage, fxText, installPackage, installedInstruments, installedPlugins, installedTools, pluginSource, pluginsVersion, removePlugin, subscribePlugins, updatePlugin, vstPackageFromFile, vstPackageFromUrl, wamPackageFromUrl, type PluginPackage } from '../plugins'
import PluginConfirmDialog, { pluginErrorText as errorText } from './PluginConfirmDialog'
import { canInstall as installable, catalogPackage, useCatalog, type CatalogPlugin } from './pluginCatalog'

/** この画面が使う訳文のキー（アプリの訳文に同じキーを置く） */
export type PluginManagerKey =
  | 'plugins.intro' | 'plugins.url' | 'plugins.add' | 'plugins.empty' | 'plugins.remove' | 'plugins.confirmTitle' | 'plugins.author' | 'plugins.version' | 'plugins.permissions'
  | 'plugins.permissionsNone' | 'plugins.notice' | 'plugins.install' | 'plugins.cancel' | 'plugins.replace' | 'plugins.update' | 'plugins.updated' | 'plugins.upToDate' | 'plugins.noSource'
  | 'plugins.vst.pick' | 'plugins.vst.notice' | 'plugins.vst.warning' | 'plugins.vst.load' | 'plugins.vst.loadHeavy' | 'plugins.error.fetch' | 'plugins.error.vst' | 'plugins.error.wam' | 'plugins.error.manifest' | 'plugins.error.api' | 'plugins.error.kind' | 'plugins.error.format' | 'plugins.error.id' | 'plugins.error.processor' | 'plugins.error.reserved'
  | 'plugins.warning.folderOnly'

export type PluginManagerCatalogKey =
  | 'plugins.catalog' | 'plugins.catalog.search' | 'plugins.catalog.loading' | 'plugins.catalog.error' | 'plugins.catalog.empty' | 'plugins.catalog.unsupported' | 'plugins.catalog.installed' | 'plugins.catalog.source'

function httpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
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
  const { catalog, status: catalogStatus, error: catalogError } = useCatalog(p.registryUrl)
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
      setPending(await catalogPackage(entry, p.vst))
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
            const canInstall = installable(entry, p.vst)
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
      <PluginConfirmDialog t={t} lang={p.lang} pending={pending} busy={busy} onCancel={() => setPending(null)} onInstall={() => void install()} />
    </Box>
  )
}

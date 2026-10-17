// プラグインの導入と管理の画面（設定の「プラグイン」の中身。WeVocalSynth と WeVocal Studio で共通。訳文はアプリの t を渡す）
import { useRef, useState, useSyncExternalStore } from 'react'
import { Box, Button, DialogActions, DialogContent, IconButton, TextField, Typography } from '@mui/material'
import { WindowDialog, pevenFont } from 'pevenmui'
import { fetchPackage, fxText, installPackage, installedInstruments, installedPlugins, installedTools, PluginError, pluginsVersion, removePlugin, subscribePlugins, updatePlugin, vstPackageFromFile, vstPackageFromUrl, wamPackageFromUrl, type PluginPackage } from '../plugins'

/** この画面が使う訳文のキー（アプリの訳文に同じキーを置く） */
export type PluginManagerKey =
  | 'plugins.intro' | 'plugins.url' | 'plugins.add' | 'plugins.empty' | 'plugins.remove' | 'plugins.confirmTitle' | 'plugins.author' | 'plugins.version' | 'plugins.permissions'
  | 'plugins.permissionsNone' | 'plugins.notice' | 'plugins.install' | 'plugins.cancel' | 'plugins.replace' | 'plugins.update' | 'plugins.updated' | 'plugins.upToDate' | 'plugins.noSource'
  | 'plugins.vst.pick' | 'plugins.vst.notice' | 'plugins.error.fetch' | 'plugins.error.vst' | 'plugins.error.wam' | 'plugins.error.manifest' | 'plugins.error.api' | 'plugins.error.kind' | 'plugins.error.format' | 'plugins.error.id' | 'plugins.error.processor' | 'plugins.error.reserved'

/** エラーを画面の文にする（VST の読み込みの失敗は、理由の詳細を添える） */
function errorText(t: (key: PluginManagerKey) => string, e: unknown) {
  const base = t(`plugins.error.${e instanceof PluginError ? e.code : 'fetch'}` as PluginManagerKey)
  return e instanceof PluginError && e.detail ? `${base}（${e.detail}）` : base
}

export default function PluginManager(p: { t: (key: PluginManagerKey, vars?: Record<string, string | number>) => string; lang: string; /** 試験的機能の VST（DLL をエミュレーターで動かす）の入口を出すか */ vst?: boolean }) {
  const t = p.t
  useSyncExternalStore(subscribePlugins, pluginsVersion)
  // 導入したもの（エフェクトと音源）
  const list = [...installedPlugins(), ...installedInstruments(), ...installedTools()]
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
  const fetchIt = async () => {
    setBusy(true)
    setError('')
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
    try {
      setPending(await vstPackageFromFile(file))
    } catch (e) {
      setError(errorText(t, e))
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }
  const install = async () => {
    if (!pending) return
    setBusy(true)
    try {
      await installPackage(pending)
      setPending(null)
      setUrl('')
    } catch {
      setError(t('plugins.error.fetch'))
    } finally {
      setBusy(false)
    }
  }
  const pm = pending?.manifest

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('plugins.intro')}</Typography>
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
          <Button size="small" onClick={() => void update(pl.manifest.id)}>
            {t('plugins.update')}
          </Button>
          <IconButton size="small" aria-label={t('plugins.remove')} title={t('plugins.remove')} onClick={() => void removePlugin(pl.manifest.id)}>
            ×
          </IconButton>
        </Box>
      ))}
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

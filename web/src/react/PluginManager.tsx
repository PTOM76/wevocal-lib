// プラグインの導入と管理の画面（設定の「プラグイン」の中身。WeVocalSynth と WeVocal Studio で共通。訳文はアプリの t を渡す）
import { useState, useSyncExternalStore } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, TextField, Typography } from '@mui/material'
import { pevenFont } from 'pevenmui'
import { fetchPackage, fxText, installPackage, installedPlugins, PluginError, pluginsVersion, removePlugin, subscribePlugins, type PluginPackage } from '../plugins'

/** この画面が使う訳文のキー（アプリの訳文に同じキーを置く） */
export type PluginManagerKey =
  | 'plugins.intro' | 'plugins.url' | 'plugins.add' | 'plugins.empty' | 'plugins.remove' | 'plugins.confirmTitle' | 'plugins.author' | 'plugins.version' | 'plugins.permissions'
  | 'plugins.permissionsNone' | 'plugins.notice' | 'plugins.install' | 'plugins.cancel' | 'plugins.replace'
  | 'plugins.error.fetch' | 'plugins.error.manifest' | 'plugins.error.api' | 'plugins.error.kind' | 'plugins.error.format' | 'plugins.error.id' | 'plugins.error.processor' | 'plugins.error.reserved'

export default function PluginManager(p: { t: (key: PluginManagerKey, vars?: Record<string, string | number>) => string; lang: string }) {
  const t = p.t
  useSyncExternalStore(subscribePlugins, pluginsVersion)
  const list = installedPlugins()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // 確かめている途中のもの（導入を押すまで保存しない）
  const [pending, setPending] = useState<PluginPackage | null>(null)

  const fetchIt = async () => {
    setBusy(true)
    setError('')
    try {
      setPending(await fetchPackage(url.trim()))
    } catch (e) {
      setError(t(`plugins.error.${e instanceof PluginError ? e.code : 'fetch'}`))
    } finally {
      setBusy(false)
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
          <IconButton size="small" aria-label={t('plugins.remove')} title={t('plugins.remove')} onClick={() => void removePlugin(pl.manifest.id)}>
            ×
          </IconButton>
        </Box>
      ))}
      <Dialog open={!!pm} onClose={() => setPending(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: pevenFont('xl'), py: 1.5 }}>{t('plugins.confirmTitle')}</DialogTitle>
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
      </Dialog>
    </Box>
  )
}

// プロジェクトを開いたとき、入っていないプラグインを一覧にして、カタログから導入できるようにするダイアログ（閉じれば素通しのまま開く）
import { useState, useSyncExternalStore } from 'react'
import { Box, Button, DialogActions, DialogContent, Typography } from '@mui/material'
import { WindowDialog, pevenFont } from 'pevenmui'
import { findPlugin, installPackage, pluginsVersion, subscribePlugins, type PluginPackage } from '../plugins'
import PluginConfirmDialog, { pluginErrorText } from './PluginConfirmDialog'
import { canInstall, catalogPackage, findCatalogEntry, useCatalog, type CatalogPlugin } from './pluginCatalog'
import type { PluginManagerCatalogKey, PluginManagerKey } from './PluginManager'

/** このダイアログが使う訳文のキー（アプリの訳文に同じキーを置く） */
export type MissingPluginsKey = 'plugins.missing.title' | 'plugins.missing.intro' | 'plugins.missing.notFound' | 'plugins.missing.close'

export default function MissingPluginsDialog(p: {
  t: (key: PluginManagerKey | PluginManagerCatalogKey | MissingPluginsKey, vars?: Record<string, string | number>) => string
  lang: string
  open: boolean
  /** 入っていないプラグインの id */
  ids: string[]
  registryUrl: string
  /** 試験的機能の VST を導入できるか */
  vst?: boolean
  onClose: () => void
}) {
  const t = p.t
  useSyncExternalStore(subscribePlugins, pluginsVersion)
  const { catalog, status, error: catalogError } = useCatalog(p.open ? p.registryUrl : undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<PluginPackage | null>(null)

  const pick = async (entry: CatalogPlugin) => {
    setBusy(true)
    setError('')
    try {
      setPending(await catalogPackage(entry, p.vst))
    } catch (e) {
      setError(pluginErrorText(t, e))
    } finally {
      setBusy(false)
    }
  }
  const install = async () => {
    if (!pending) return
    setBusy(true)
    setError('')
    try {
      await installPackage(pending)
      setPending(null)
    } catch (e) {
      setError(pluginErrorText(t, e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t('plugins.missing.title')} name="missingPlugins" width={520} height={420} dialogProps={{ fullWidth: true, maxWidth: 'sm' }}>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('plugins.missing.intro')}</Typography>
          {status === 'loading' && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('plugins.catalog.loading')}</Typography>}
          {status === 'error' && <Typography role="alert" sx={{ fontSize: pevenFont('sm'), color: 'error.main' }}>{t('plugins.catalog.error')}: {catalogError}</Typography>}
          {error && <Typography role="alert" sx={{ fontSize: pevenFont('sm'), color: 'error.main' }}>{error}</Typography>}
          {p.ids.map((id) => {
            const entry = findCatalogEntry(catalog, id)
            const installed = !!findPlugin(id)
            return (
              <Box key={id} sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider', py: 1 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: pevenFont('base') }}>{entry?.name ?? id}</Typography>
                  <Typography noWrap sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>
                    {entry ? `${id} · ${entry.author}` : id}
                  </Typography>
                </Box>
                {installed
                  ? <Typography sx={{ fontSize: pevenFont('sm'), color: 'success.main' }}>{t('plugins.catalog.installed')}</Typography>
                  : entry && canInstall(entry, p.vst)
                    ? <Button size="small" disabled={busy} onClick={() => void pick(entry)}>{t('plugins.install')}</Button>
                    : status === 'ready' && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t(entry ? 'plugins.catalog.unsupported' : 'plugins.missing.notFound')}</Typography>}
              </Box>
            )
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={p.onClose}>
          {t(p.ids.every((id) => findPlugin(id)) ? 'plugins.missing.close' : 'plugins.cancel')}
        </Button>
      </DialogActions>
      <PluginConfirmDialog t={t} lang={p.lang} pending={pending} busy={busy} onCancel={() => setPending(null)} onInstall={() => void install()} />
    </WindowDialog>
  )
}

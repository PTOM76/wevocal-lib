// プラグインを導入する前の確認（作者、版、権限を見せる。PluginManager と MissingPluginsDialog で共通）
import { Box, Button, DialogActions, DialogContent, Typography } from '@mui/material'
import { WindowDialog, pevenFont } from 'pevenmui'
import { fxText, installedPlugins, PluginError, type PluginPackage } from '../plugins'
import type { PluginManagerKey } from './PluginManager'

/** エラーを画面の文にする（VST の読み込みの失敗は、理由の詳細を添える） */
export function pluginErrorText(t: (key: PluginManagerKey) => string, e: unknown) {
  const base = t(`plugins.error.${e instanceof PluginError ? e.code : 'fetch'}` as PluginManagerKey)
  if (e instanceof PluginError && e.detail) return `${base}（${e.detail}）`
  return e instanceof Error && e.message ? e.message : base
}

export default function PluginConfirmDialog(p: {
  t: (key: PluginManagerKey, vars?: Record<string, string | number>) => string
  lang: string
  pending: PluginPackage | null
  busy: boolean
  onCancel: () => void
  onInstall: () => void
}) {
  const t = p.t
  const pm = p.pending?.manifest
  return (
    // 設定に従って、別の窓（ポップアップ）にも出せる（PevenMUI の WindowDialog）
    <WindowDialog open={!!pm} onClose={p.onCancel} title={t('plugins.confirmTitle')} name="pluginConfirm" width={460} height={520} dialogProps={{ fullWidth: true, maxWidth: 'xs' }}>
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
            {pm.format === 'vst' && p.pending?.load !== undefined && (
              <Typography sx={{ fontSize: pevenFont('sm'), color: p.pending.load >= 1 ? 'warning.main' : 'text.secondary' }}>
                {t(p.pending.load >= 1 ? 'plugins.vst.loadHeavy' : 'plugins.vst.load', { n: Math.max(1, Math.round(p.pending.load * 100)) })}
              </Typography>
            )}
            {installedPlugins().some((x) => x.manifest.id === pm.id) && <Typography sx={{ fontSize: pevenFont('sm'), color: 'warning.main' }}>{t('plugins.replace')}</Typography>}
            <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary', mt: 1 }}>{t('plugins.notice')}</Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={p.onCancel}>
          {t('plugins.cancel')}
        </Button>
        <Button size="small" disabled={p.busy} onClick={p.onInstall}>
          {t('plugins.install')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}

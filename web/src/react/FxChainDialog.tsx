// FX の列のダイアログ（WeVocalSynth と WeVocal Studio で共通）。左に列（オンオフ、並び替え、削除）、右に選んだエフェクトの画面。訳文はアプリの t を渡す
import { useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Switch, Typography } from '@mui/material'
import { ContextMenu, PresetMenu, pevenFont, type Preset } from 'pevenmui'
import type { FxPlugin, FxSlot } from '../../../plugin-sdk'
import { DEV_PLUGINS, STANDARD_PLUGINS, defaultValues, findPlugin, fxText, migrateValues, newSlot } from '../plugins/host'
import { EQ_ID, eqToSlot, slotToEq } from '../plugins/eq'
import { EqPanel, type EqDialogKey } from './EqDialog'
import FxParams from './FxParams'

/** このダイアログが使う訳文のキー（EQ の画面のキーも使う） */
export type FxChainDialogKey =
  | EqDialogKey
  | 'fx.title' | 'fx.add' | 'fx.empty' | 'fx.remove' | 'fx.up' | 'fx.down' | 'fx.missing' | 'fx.on'
  | 'fx.preset' | 'fx.presetEmpty' | 'fx.presetSave' | 'fx.presetRemove' | 'fx.presetName'

type Values = Record<string, number>

export default function FxChainDialog(p: {
  t: (key: FxChainDialogKey, vars?: Record<string, string | number>) => string
  /** アプリの言語（'ja_jp' など。プラグインの訳文を引く） */
  lang: string
  open: boolean
  /** 掛けている先の名前（トラック名か「マスター」） */
  name: string
  slots: FxSlot[]
  /** 変えた列。merge はつまみのドラッグ中にまとめる履歴のキー（無ければ 1 回ごとに残す） */
  onChange: (slots: FxSlot[], merge?: string) => void
  /** 開発者向けのプラグイン（雛形）を追加の一覧に出す */
  dev?: boolean
  playing?: boolean
  onTogglePlay?: () => void
  /** 利用者のプリセット（プラグインの id ごと）。保存はアプリが行う */
  userPresets?: Record<string, Preset<Values>[]>
  onUserPresetsChange?: (plugin: string, list: Preset<Values>[]) => void
  onClose: () => void
}) {
  const t = p.t
  const [sel, setSel] = useState(0)
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null)
  const index = Math.min(sel, p.slots.length - 1)
  const slot = p.slots[index] as FxSlot | undefined
  const plugin = slot && findPlugin(slot.plugin)
  const name = (pl: FxPlugin) => fxText(pl, 'name', p.lang)

  const patch = (i: number, s: Partial<FxSlot>, merge?: string) => p.onChange(p.slots.map((x, j) => (j === i ? { ...x, ...s } : x)), merge)
  const move = (i: number, d: number) => {
    const list = [...p.slots]
    ;[list[i], list[i + d]] = [list[i + d], list[i]]
    p.onChange(list)
    setSel(i + d)
  }
  const add = (pl: FxPlugin) => {
    p.onChange([...p.slots, newSlot(pl)])
    setSel(p.slots.length)
  }
  const remove = (i: number) => {
    p.onChange(p.slots.filter((_, j) => j !== i))
    setSel(Math.max(0, i - 1))
  }
  const stop = (e: { stopPropagation: () => void }, run: () => void) => {
    e.stopPropagation()
    run()
  }
  const plugins = [...STANDARD_PLUGINS, ...(p.dev ? DEV_PLUGINS : [])]

  const builtin: Preset<Values>[] = (plugin?.manifest.presets ?? []).map((x) => ({ name: x.name, params: x.values }))
  const presets = [...builtin, ...((plugin && p.userPresets?.[plugin.manifest.id]) || [])]

  return (
    <Dialog open={p.open} onClose={p.onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontSize: pevenFont('xl'), py: 1.5 }}>{t('fx.title', { name: p.name })}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, minHeight: 280 }}>
          <Box sx={{ width: { xs: '100%', sm: 240 }, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {!p.slots.length && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('fx.empty')}</Typography>}
            {p.slots.map((s, i) => {
              const pl = findPlugin(s.plugin)
              return (
                <Box
                  key={i}
                  onClick={() => setSel(i)}
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, borderRadius: 0.5, cursor: 'pointer', bgcolor: i === index ? 'action.selected' : undefined, opacity: s.on ? 1 : 0.55 }}
                >
                  <Switch size="small" checked={s.on} onClick={(e) => e.stopPropagation()} onChange={(e) => patch(i, { on: e.target.checked })} slotProps={{ input: { 'aria-label': t('fx.on') } }} />
                  <Typography noWrap sx={{ flex: 1, fontSize: pevenFont('base') }}>
                    {pl ? name(pl) : s.plugin}
                  </Typography>
                  <IconButton size="small" aria-label={t('fx.up')} disabled={i === 0} onClick={(e) => stop(e, () => move(i, -1))}>
                    ↑
                  </IconButton>
                  <IconButton size="small" aria-label={t('fx.down')} disabled={i === p.slots.length - 1} onClick={(e) => stop(e, () => move(i, 1))}>
                    ↓
                  </IconButton>
                  <IconButton size="small" aria-label={t('fx.remove')} onClick={(e) => stop(e, () => remove(i))}>
                    ×
                  </IconButton>
                </Box>
              )
            })}
            <Button
              size="small"
              sx={{ alignSelf: 'flex-start' }}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setAddAt({ x: r.left, y: r.bottom })
              }}
            >
              {t('fx.add')}
            </Button>
            <ContextMenu position={addAt} entries={plugins.map((pl) => ({ label: name(pl), onClick: () => add(pl) }))} onClose={() => setAddAt(null)} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {slot && !plugin && <Typography sx={{ fontSize: pevenFont('base'), color: 'text.secondary' }}>{t('fx.missing', { id: slot.plugin })}</Typography>}
            {slot && plugin && plugin.manifest.id === EQ_ID && (
              <EqPanel t={t} eq={slotToEq(slot)} onChange={(eq) => patch(index, { values: eqToSlot(eq).values, on: eq.on }, `fx:${index}:eq`)} />
            )}
            {slot && plugin && plugin.manifest.id !== EQ_ID && (
              <>
                <Box sx={{ mb: 1 }}>
                  <PresetMenu
                    params={slot.values}
                    presets={presets}
                    onApply={(v) => patch(index, { values: { ...defaultValues(plugin.manifest), ...migrateValues(plugin.manifest, v) } })}
                    onChange={(list) => p.onUserPresetsChange?.(plugin.manifest.id, list.filter((x) => !builtin.some((b) => b.name === x.name)))}
                    labels={{ button: t('fx.preset'), empty: t('fx.presetEmpty'), save: t('fx.presetSave'), remove: t('fx.presetRemove'), defaultName: (n) => t('fx.presetName', { n }) }}
                    disabled={!p.onUserPresetsChange && !builtin.length}
                  />
                </Box>
                <FxParams plugin={plugin} values={slot.values} lang={p.lang} onChange={(id, v) => patch(index, { values: { ...slot.values, [id]: v } }, `fx:${index}:${id}`)} />
              </>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        {p.onTogglePlay && (
          <Button size="small" onClick={p.onTogglePlay} sx={{ mr: 'auto' }}>
            {p.playing ? t('eq.pause') : t('eq.play')}
          </Button>
        )}
        <Button size="small" onClick={p.onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

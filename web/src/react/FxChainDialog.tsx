// FX の列のダイアログ（WeVocalSynth と WeVocal Studio で共通）。左に列（オンオフ、並び替え、削除）、右に選んだエフェクトの画面。訳文はアプリの t を渡す
import { useRef, useState, useSyncExternalStore } from 'react'
import { Box, Button, DialogActions, DialogContent, IconButton, Switch, Tooltip, Typography } from '@mui/material'
import { ContextMenu, PresetMenu, WindowDialog, pevenFont, type Preset } from 'pevenmui'
import type { FxPlugin, FxSlot } from '../../../plugin-sdk'
import { DEV_PLUGINS, availablePlugins, defaultValues, findPlugin, fxText, isNeutralChain, migrateValues, newSlot } from '../plugins/host'
import { EQ_ID, eqToSlot, slotToEq } from '../plugins/eq'
import { presetsFromJson, presetsToJson } from '../plugins/presets'
import { downloadBlob } from '../wav'
import { EqPanel, type EqDialogKey } from './EqDialog'
import { isOverloaded, loadOf, loadVersion, pluginsVersion, subscribeLoad, subscribePlugins } from '../plugins/registry'
import { Choice } from './ExportDialog'
import FxParams from './FxParams'
import PluginUi from './PluginUi'

/** このダイアログが使う訳文のキー（EQ の画面のキーも使う） */
export type FxChainDialogKey =
  | EqDialogKey
  | 'fx.title' | 'fx.add' | 'fx.empty' | 'fx.remove' | 'fx.up' | 'fx.down' | 'fx.missing' | 'fx.on'
  | 'fx.applyHelp' | 'fx.load' | 'fx.overloaded' | 'fx.autoLane' | 'fx.sidechainSource' | 'fx.sidechainSelf' | 'fx.offlineOnly' | 'fx.offlineOnlyHelp' | 'fx.overloadedHelp' | 'fx.preset' | 'fx.presetEmpty' | 'fx.presetSave' | 'fx.presetRemove' | 'fx.presetName' | 'fx.presetExport' | 'fx.presetImport' | 'fx.presetImportError'

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
  /** 列をトラックの音声に書き込む（書き込んだら列は空に戻る。元の音を書き換えないアプリでは渡さない） */
  onApply?: () => void
  busy?: boolean
  /** 音を作る処理の負荷（0〜1。無ければ出さない） */
  load?: number | null
  /** サイドチェーンで音を取れるトラック（無ければ選ぶ欄を出さない） */
  sidechainSources?: { id: string; name: string }[]
  /** 時間軸に出しているオートメーション（何番目の項目の、どのつまみか）と、出すつまみを選ぶ。渡さなければ A のボタンを出さない */
  autoLane?: { slot: number; param: string } | null
  onAutoLane?: (lane: { slot: number; param: string } | null) => void
  /** 利用者のプリセット（プラグインの id ごと）。保存はアプリが行う */
  userPresets?: Record<string, Preset<Values>[]>
  onUserPresetsChange?: (plugin: string, list: Preset<Values>[]) => void
  onClose: () => void
}) {
  const t = p.t
  // 導入したプラグインが増減したら描き直す
  useSyncExternalStore(subscribePlugins, pluginsVersion)
  // 導入したプラグインの負荷と、重くて素通しにしたもの
  useSyncExternalStore(subscribeLoad, loadVersion)
  const [sel, setSel] = useState(0)
  // ドラッグで並び替えているときの、つかんでいる項目と、落とす位置（その項目の前）
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  // 落とす瞬間に読むための写し（state は次の描画まで変わらない）
  const dragRef = useRef<number | null>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState(false)
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null)
  const index = Math.min(sel, p.slots.length - 1)
  const slot = p.slots[index] as FxSlot | undefined
  const plugin = slot && findPlugin(slot.plugin)
  // 古い版のつまみの id は、プラグインの migrate で読み替えて見せる（直したときに新しい id で保存される）
  const values = slot && plugin ? migrateValues(plugin.manifest, slot.values) : {}
  const name = (pl: FxPlugin) => fxText(pl, 'name', p.lang)

  const patch = (i: number, s: Partial<FxSlot>, merge?: string) => p.onChange(p.slots.map((x, j) => (j === i ? { ...x, ...s } : x)), merge)
  const move = (i: number, d: number) => {
    const list = [...p.slots]
    ;[list[i], list[i + d]] = [list[i + d], list[i]]
    p.onChange(list)
    setSel(i + d)
  }
  /** i の項目を j の位置へ動かす（ドラッグ） */
  const moveTo = (i: number, j: number) => {
    if (i === j || i + 1 === j) return
    const list = [...p.slots]
    const [it] = list.splice(i, 1)
    list.splice(j > i ? j - 1 : j, 0, it)
    p.onChange(list)
    setSel(j > i ? j - 1 : j)
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
  const plugins = [...availablePlugins(), ...(p.dev ? DEV_PLUGINS : [])]

  const builtin: Preset<Values>[] = (plugin?.manifest.presets ?? []).map((x) => ({ name: x.name, params: x.values }))
  const presets = [...builtin, ...((plugin && p.userPresets?.[plugin.manifest.id]) || [])]

  return (
    // 設定に従って、別の窓（ポップアップ）にも出せる（PevenMUI の WindowDialog）
    <WindowDialog open={p.open} onClose={p.onClose} title={t('fx.title', { name: p.name })} name="fx" width={900} height={640} dialogProps={{ fullWidth: true, maxWidth: 'md' }}>
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
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    dragRef.current = i
                    setDragFrom(i)
                  }}
                  onDragOver={(e) => {
                    if (dragRef.current === null) return
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    // 行の上半分なら前、下半分なら次の項目の前に落とす
                    setDragOver(e.clientY < r.top + r.height / 2 ? i : i + 1)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    if (dragRef.current !== null) moveTo(dragRef.current, e.clientY < r.top + r.height / 2 ? i : i + 1)
                    dragRef.current = null
                    setDragFrom(null)
                    setDragOver(null)
                  }}
                  onDragEnd={() => {
                    dragRef.current = null
                    setDragFrom(null)
                    setDragOver(null)
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 0.5,
                    borderRadius: 0.5,
                    cursor: 'grab',
                    bgcolor: i === index ? 'action.selected' : undefined,
                    opacity: dragFrom === i ? 0.4 : s.on ? 1 : 0.55,
                    // 落とす位置に線を出す
                    boxShadow: dragFrom !== null && dragOver === i ? (t2) => `0 -2px 0 ${t2.palette.primary.main}` : dragFrom !== null && dragOver === i + 1 && i === p.slots.length - 1 ? (t2) => `0 2px 0 ${t2.palette.primary.main}` : undefined,
                  }}
                >
                  <Switch size="small" checked={s.on} onClick={(e) => e.stopPropagation()} onChange={(e) => patch(i, { on: e.target.checked })} slotProps={{ input: { 'aria-label': t('fx.on') } }} />
                  <Typography noWrap sx={{ flex: 1, fontSize: pevenFont('base') }}>
                    {pl ? name(pl) : s.plugin}
                  </Typography>
                  {pl?.manifest.realtime === false && (
                    <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }} title={t('fx.offlineOnlyHelp')}>
                      {t('fx.offlineOnly')}
                    </Typography>
                  )}
                  {isOverloaded(s.plugin) ? (
                    <Typography sx={{ fontSize: pevenFont('sm'), color: 'error.main' }} title={t('fx.overloadedHelp')}>
                      {t('fx.overloaded')}
                    </Typography>
                  ) : (
                    loadOf(s.plugin) !== undefined && s.on && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{Math.round(loadOf(s.plugin)! * 100)}%</Typography>
                  )}
                  {/* ドラッグが使えない画面（タッチ）では、矢印で動かす */}
                  <Box sx={{ display: 'none', '@media (pointer: coarse)': { display: 'flex' } }}>
                    <IconButton size="small" aria-label={t('fx.up')} disabled={i === 0} onClick={(e) => stop(e, () => move(i, -1))}>
                      ↑
                    </IconButton>
                    <IconButton size="small" aria-label={t('fx.down')} disabled={i === p.slots.length - 1} onClick={(e) => stop(e, () => move(i, 1))}>
                      ↓
                    </IconButton>
                  </Box>
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
                <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                  <PresetMenu
                    params={values}
                    presets={presets}
                    onApply={(v) => patch(index, { values: { ...defaultValues(plugin.manifest), ...migrateValues(plugin.manifest, v) } })}
                    onChange={(list) => p.onUserPresetsChange?.(plugin.manifest.id, list.filter((x) => !builtin.some((b) => b.name === x.name)))}
                    labels={{ button: t('fx.preset'), empty: t('fx.presetEmpty'), save: t('fx.presetSave'), remove: t('fx.presetRemove'), defaultName: (n) => t('fx.presetName', { n }) }}
                    disabled={!p.onUserPresetsChange && !builtin.length}
                  />
                  <Button size="small" disabled={!presets.length} onClick={() => downloadBlob(new Blob([presetsToJson(plugin.manifest.id, presets)], { type: 'application/json' }), `${plugin.manifest.id}.presets.json`)}>
                    {t('fx.presetExport')}
                  </Button>
                  <Button size="small" disabled={!p.onUserPresetsChange} onClick={() => importInput.current?.click()}>
                    {t('fx.presetImport')}
                  </Button>
                  <input
                    ref={importInput}
                    type="file"
                    accept=".json,application/json"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (!file) return
                      void file.text().then((text) => {
                        const list = presetsFromJson(text, plugin.manifest.id)
                        setImportError(!list)
                        // 同じ名前は置き換える
                        if (list) p.onUserPresetsChange?.(plugin.manifest.id, [...(p.userPresets?.[plugin.manifest.id] ?? []).filter((x) => !list.some((y) => y.name === x.name)), ...list])
                      })
                    }}
                  />
                  {importError && <Typography sx={{ fontSize: pevenFont('sm'), color: 'error.main' }}>{t('fx.presetImportError')}</Typography>}
                </Box>
                {plugin.manifest.sidechain && p.sidechainSources && (
                  <Box sx={{ mb: 1 }}>
                    <Choice
                      label={t('fx.sidechainSource')}
                      value={slot.sidechain ?? ''}
                      options={[['', t('fx.sidechainSelf')], ...p.sidechainSources.map((x): [string, string] => [x.id, x.name])]}
                      onChange={(v) => patch(index, { sidechain: v || undefined })}
                    />
                  </Box>
                )}
                {plugin.ui ? (
                  <PluginUi
                    html={plugin.ui}
                    params={plugin.manifest.params}
                    values={values}
                    texts={Object.fromEntries(Object.keys({ ...plugin.lang.en_us, ...plugin.lang[p.lang] }).map((k) => [k, fxText(plugin, k, p.lang)]))}
                    onChange={(id, v) => patch(index, { values: { ...values, [id]: v } }, `fx:${index}:${id}`)}
                  />
                ) : (
                  <FxParams
                    plugin={plugin}
                    values={values}
                    lang={p.lang}
                    onChange={(id, v) => patch(index, { values: { ...values, [id]: v } }, `fx:${index}:${id}`)}
                    automation={
                      p.onAutoLane
                        ? {
                            lane: p.autoLane?.slot === index ? p.autoLane.param : null,
                            has: new Set(Object.entries(slot.auto ?? {}).filter(([, pts]) => pts.length).map(([k]) => k)),
                            onLane: (param) => p.onAutoLane!(p.autoLane?.slot === index && p.autoLane.param === param ? null : { slot: index, param }),
                            title: t('fx.autoLane'),
                          }
                        : undefined
                    }
                  />
                )}
              </>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        {p.load != null && (
          <Typography sx={{ fontSize: pevenFont('sm'), color: p.load > 0.8 ? 'error.main' : 'text.secondary', mr: 'auto' }}>{t('fx.load', { n: Math.round(p.load * 100) })}</Typography>
        )}
        {p.onTogglePlay && (
          <Button size="small" onClick={p.onTogglePlay} sx={{ mr: 'auto' }}>
            {p.playing ? t('eq.pause') : t('eq.play')}
          </Button>
        )}
        {p.onApply && (
          <Tooltip title={t('fx.applyHelp')}>
            <span>
              <Button size="small" disabled={p.busy || isNeutralChain(p.slots)} onClick={p.onApply}>
                {t('eq.apply')}
              </Button>
            </span>
          </Tooltip>
        )}
        <Button size="small" onClick={p.onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}

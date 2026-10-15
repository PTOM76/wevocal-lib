// ピッチの一括操作のダイアログ（音程に揃える、ビブラート）。WeVocalSynth と WeVocal Studio で共通。訳文はアプリが PitchToolText で渡す
import { createContext, useContext, useState, type ReactNode } from 'react'
import {
  Box,
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Typography,
} from '@mui/material'
import { SliderRow, WindowDialog, enterToSubmit, pevenFont } from 'pevenmui'
import { rateForBpm, type SnapOptions, type VibratoOptions } from '../pitchTools'
import { noteName } from '../notes'

/** このダイアログが使う訳文のキー（アプリの訳文に同じキーを置く） */
export type PitchToolKey =
  | 'common.whole'
  | 'common.selection'
  | 'common.cancel'
  | 'midi.choose'
  | 'midi.loadFailed'
  | 'midi.noNotes'
  | 'midi.none'
  | 'midi.offset'
  | 'midi.tempoMidi'
  | 'midi.tempoProject'
  | 'midi.title'
  | 'midi.track'
  | 'midi.trackItem'
  | 'midi.transpose'
  | 'pitchTool.create'
  | 'pitchTool.hint'
  | 'pitchTool.target'
  | 'process.semitoneUnit'
  | 'snap.keepShape'
  | 'snap.nearest'
  | 'snap.note'
  | 'snap.speed'
  | 'snap.strength'
  | 'snap.title'
  | 'vibrato.delay'
  | 'vibrato.depth'
  | 'vibrato.rate'
  | 'vibrato.secondUnit'
  | 'vibrato.syncBpm'
  | 'vibrato.title'

/** アプリの訳文（PitchToolKey のキーを持つ）。ダイアログを置く所の外側で Provider に入れる */
export const PitchToolText = createContext<(key: PitchToolKey, vars?: Record<string, string | number>) => string>((k) => k)
export const useT = () => useContext(PitchToolText)

/** 揃え先に選べる音（C2〜C6） */
const NOTES = Array.from({ length: 49 }, (_, i) => 36 + i)

/** 共通の枠: タイトル・対象範囲の表示・「作成」「キャンセル」 */
export function ToolDialog(p: { open: boolean; title: string; hasSelection: boolean; onClose: () => void; onRun: () => void; children: ReactNode }) {
  const t = useT()
  return (
    // 設定に従って、別の窓（ポップアップ）にも出せる（PevenMUI の WindowDialog）
    <WindowDialog
      open={p.open}
      onClose={p.onClose}
      title={p.title}
      name="pitchTool"
      width={420}
      height={460}
      dialogProps={{ fullWidth: true, maxWidth: 'xs' }}
      onKeyDown={enterToSubmit(() => {
        p.onRun()
        p.onClose()
      })}
    >
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography className="selectable" sx={{ fontSize: pevenFont('md'), color: 'text.secondary' }}>
          {t('pitchTool.target', { range: t(p.hasSelection ? 'common.selection' : 'common.whole') })}
        </Typography>
        {p.children}
        <Typography className="selectable" sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('pitchTool.hint')}</Typography>
      </DialogContent>
      <DialogActions>
        <Button
          size="small"
          onClick={() => {
            p.onRun()
            p.onClose()
          }}
        >
          {t('pitchTool.create')}
        </Button>
        <Button size="small" onClick={p.onClose}>
          {t('common.cancel')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}

export interface DialogProps<O> {
  open: boolean
  hasSelection: boolean
  onClose: () => void
  onRun: (o: O) => void
}

/** ビブラートを加える。速さの初期値は設定の BPM に合わせる */
export function VibratoDialog(p: DialogProps<VibratoOptions> & { bpm: number }) {
  const t = useT()
  const [o, setO] = useState<VibratoOptions>(() => ({ depth: 0.5, rate: rateForBpm(p.bpm), delay: 0.2 }))
  const set = (patch: Partial<VibratoOptions>) => setO((v) => ({ ...v, ...patch }))
  return (
    <ToolDialog open={p.open} title={t('vibrato.title')} hasSelection={p.hasSelection} onClose={p.onClose} onRun={() => p.onRun(o)}>
      <SliderRow label={t('vibrato.depth')} value={o.depth} onChange={(v) => set({ depth: v })} min={0} max={2} step={0.05} unit={t('process.semitoneUnit')} />
      <SliderRow label={t('vibrato.rate')} value={o.rate} onChange={(v) => set({ rate: v })} min={2} max={10} step={0.1} unit="Hz" />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: -1 }}>
        <Button size="small" onClick={() => set({ rate: rateForBpm(p.bpm) })} sx={{ fontSize: pevenFont('md') }}>
          {t('vibrato.syncBpm', { bpm: p.bpm })}
        </Button>
      </Box>
      <SliderRow label={t('vibrato.delay')} value={o.delay} onChange={(v) => set({ delay: v })} min={0} max={1} step={0.05} unit={t('vibrato.secondUnit')} />
    </ToolDialog>
  )
}

/** 音階に揃える（指定した音へ、または音ごとに近い半音へ）。既定は指定した音 */
export function SnapDialog(p: DialogProps<SnapOptions>) {
  const t = useT()
  const [o, setO] = useState<SnapOptions>({ mode: 'note', note: 60, keepShape: false, strength: 1, speedMs: 0 })
  const set = (patch: Partial<SnapOptions>) => setO((v) => ({ ...v, ...patch }))
  return (
    <ToolDialog open={p.open} title={t('snap.title')} hasSelection={p.hasSelection} onClose={p.onClose} onRun={() => p.onRun(o)}>
      <RadioGroup value={o.mode} onChange={(e) => set({ mode: e.target.value as SnapOptions['mode'] })}>
        <FormControlLabel value="nearest" control={<Radio size="small" />} label={t('snap.nearest')} slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }} />
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <FormControlLabel value="note" control={<Radio size="small" />} label={t('snap.note')} slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }} />
          <Select
            size="small"
            value={o.note}
            disabled={o.mode !== 'note'}
            onChange={(e) => set({ note: Number(e.target.value) })}
            sx={{ fontSize: pevenFont('base'), minWidth: 90, '& .MuiSelect-select': { py: 0.5 } }}
            MenuProps={{ slotProps: { paper: { sx: { maxHeight: 300 } } } }}
          >
            {NOTES.map((m) => (
              <MenuItem key={m} value={m} sx={{ fontSize: pevenFont('base') }}>
                {noteName(m)}
              </MenuItem>
            ))}
          </Select>
        </Box>
      </RadioGroup>
      <FormControlLabel
        control={<Checkbox size="small" checked={o.keepShape} onChange={(e) => set({ keepShape: e.target.checked })} />}
        label={t('snap.keepShape')}
        slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }}
      />
      <SliderRow label={t('snap.strength')} value={Math.round(o.strength * 100)} onChange={(v) => set({ strength: v / 100 })} min={0} max={100} step={1} unit="%" />
      <SliderRow label={t('snap.speed')} value={o.speedMs} onChange={(v) => set({ speedMs: Math.round(v) })} min={0} max={300} step={5} unit="ms" />
    </ToolDialog>
  )
}

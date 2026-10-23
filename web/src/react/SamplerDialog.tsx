// MIDI の音符に並べるダイアログ（サンプラー）（WeVocalSynth と WeVocal Studio で共通。訳文はアプリの t を渡す）
import { useRef, useState } from 'react'
import { Box, Button, DialogActions, DialogContent, FormControlLabel, MenuItem, Radio, RadioGroup, Select, Typography } from '@mui/material'
import { enterToSubmit, NumberInput, SliderRow, WindowDialog, pevenFont, useMobileLayout } from 'pevenmui'
import { parseMidi, type MidiFile } from '../midi'
import type { FitMode, SamplerNote } from '../sampler'
import { noteName } from '../notes'

/** このダイアログが使う訳文のキー（アプリの訳文に同じキーを置く） */
export type SamplerDialogKey =
  | 'common.cancel'
  | 'sampler.fitStretch'
  | 'sampler.fitLoop'
  | 'sampler.fitCut'
  | 'midi.choose'
  | 'midi.loadFailed'
  | 'midi.noNotes'
  | 'midi.none'
  | 'midi.offset'
  | 'midi.tempoMidi'
  | 'midi.tempoProject'
  | 'midi.track'
  | 'midi.trackItem'
  | 'midi.transpose'
  | 'process.semitoneUnit'
  | 'sampler.base'
  | 'sampler.fit'
  | 'sampler.hint'
  | 'sampler.title'
  | 'synth.create'
  | 'vibrato.secondUnit'

export interface SamplerOptions {
  notes: SamplerNote[]
  baseNote: number
  fit: FitMode
  /** 新しいトラックの名前に使う */
  midiName: string
}

/** 素材の音程として選べる高さ（C1〜C7） */
const NOTES = Array.from({ length: 73 }, (_, i) => 24 + i)
const FITS: [FitMode, 'sampler.fitStretch' | 'sampler.fitLoop' | 'sampler.fitCut'][] = [
  ['stretch', 'sampler.fitStretch'],
  ['loop', 'sampler.fitLoop'],
  ['cut', 'sampler.fitCut'],
]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Typography sx={{ fontSize: pevenFont('base'), width: 72, flexShrink: 0 }}>{label}</Typography>
      {children}
    </Box>
  )
}

/** 選択範囲（素材）を MIDI の音符に並べて、新しいトラックを作る */
export default function SamplerDialog(p: {
  /** アプリの訳文（SamplerDialogKey のキーを持つ） */
  t: (key: SamplerDialogKey, vars?: Record<string, string | number>) => string

  open: boolean
  bpm: number
  /** 素材の音程の初期値（解析した値。分からなければ C4） */
  baseNote: number | null
  onClose: () => void
  onRun: (o: SamplerOptions) => void
}) {
  // 画面の端の欄に置ける（スマホは欄がないので、ダイアログのまま）
  const mobile = useMobileLayout()
  const t = p.t
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; midi: MidiFile } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [track, setTrack] = useState(0)
  const [offset, setOffset] = useState(0)
  const [tempo, setTempo] = useState<'midi' | 'project'>('midi')
  const [transpose, setTranspose] = useState(0)
  const [base, setBase] = useState<number | null>(null)
  const [fit, setFit] = useState<FitMode>('stretch')
  const baseNote = base ?? p.baseNote ?? 60

  const open = async (f: File) => {
    try {
      const midi = parseMidi(await f.arrayBuffer())
      if (!midi.tracks.length) throw new Error(t('midi.noNotes'))
      setFile({ name: f.name, midi })
      setTrack(0)
      setError(null)
    } catch (e) {
      setFile(null)
      setError(t('midi.loadFailed', { error: e instanceof Error ? e.message : String(e) }))
    }
  }

  const notes = file?.midi.tracks[track]?.notes ?? []
  const run = () => {
    if (!file || !notes.length) return
    const scale = tempo === 'project' && p.bpm > 0 ? file.midi.bpm / p.bpm : 1
    p.onRun({
      notes: notes.map((n) => ({ note: n.note + transpose, start: offset + n.start * scale, end: offset + n.end * scale })),
      baseNote,
      fit,
      midiName: file.midi.tracks[track]?.name || file.name.replace(/\.[^.]+$/, ''),
    })
    p.onClose()
  }

  return (
    <WindowDialog
      open={p.open}
      onClose={p.onClose}
      title={t('sampler.title')}
      name="sampler"
      dockable={!mobile}
      width={444}
      height={560}
      dialogProps={{ fullWidth: true, maxWidth: 'xs' }}
      onKeyDown={enterToSubmit(run, !!notes.length)}
    >
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button size="small" variant="outlined" onClick={() => input.current?.click()}>
            {t('midi.choose')}
          </Button>
          <Typography className="selectable" sx={{ fontSize: pevenFont('md'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {file ? file.name : t('midi.none')}
          </Typography>
          <input
            ref={input}
            type="file"
            accept=".mid,.midi,audio/midi"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void open(f)
              e.target.value = ''
            }}
          />
        </Box>
        {error && (
          <Typography className="selectable" sx={{ fontSize: pevenFont('md'), color: 'error.main' }}>
            {error}
          </Typography>
        )}
        {file && (
          <>
            <Row label={t('midi.track')}>
              <Select size="small" fullWidth value={track} onChange={(e) => setTrack(Number(e.target.value))} sx={{ fontSize: pevenFont('base'), '& .MuiSelect-select': { py: 0.5 } }}>
                {file.midi.tracks.map((tr, i) => (
                  <MenuItem key={i} value={i} sx={{ fontSize: pevenFont('base') }}>
                    {t('midi.trackItem', { name: tr.name, count: tr.notes.length })}
                  </MenuItem>
                ))}
              </Select>
            </Row>
            <Row label={t('midi.offset')}>
              <NumberInput value={offset} onChange={setOffset} min={0} max={3600} step={0.01} unit={t('vibrato.secondUnit')} width={110} ariaLabel={t('midi.offset')} />
            </Row>
            <RadioGroup value={tempo} onChange={(e) => setTempo(e.target.value as 'midi' | 'project')}>
              <FormControlLabel value="midi" control={<Radio size="small" />} label={t('midi.tempoMidi', { bpm: file.midi.bpm })} slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }} />
              <FormControlLabel value="project" control={<Radio size="small" />} label={t('midi.tempoProject', { bpm: p.bpm })} slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }} />
            </RadioGroup>
            <SliderRow label={t('midi.transpose')} value={transpose} onChange={(v) => setTranspose(Math.round(v))} min={-24} max={24} step={1} unit={t('process.semitoneUnit')} />
          </>
        )}
        <Row label={t('sampler.base')}>
          <Select
            size="small"
            value={baseNote}
            onChange={(e) => setBase(Number(e.target.value))}
            sx={{ fontSize: pevenFont('base'), minWidth: 90, '& .MuiSelect-select': { py: 0.5 } }}
            MenuProps={{ slotProps: { paper: { sx: { maxHeight: 300 } } } }}
          >
            {NOTES.map((m) => (
              <MenuItem key={m} value={m} sx={{ fontSize: pevenFont('base') }}>
                {noteName(m)}
              </MenuItem>
            ))}
          </Select>
        </Row>
        <Row label={t('sampler.fit')}>
          <Select size="small" value={fit} onChange={(e) => setFit(e.target.value as FitMode)} sx={{ fontSize: pevenFont('base'), minWidth: 120, '& .MuiSelect-select': { py: 0.5 } }}>
            {FITS.map(([v, label]) => (
              <MenuItem key={v} value={v} sx={{ fontSize: pevenFont('base') }}>
                {t(label)}
              </MenuItem>
            ))}
          </Select>
        </Row>
        <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('sampler.hint')}</Typography>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={p.onClose}>
          {t('common.cancel')}
        </Button>
        <Button size="small" disabled={!notes.length} onClick={run}>
          {t('synth.create')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}

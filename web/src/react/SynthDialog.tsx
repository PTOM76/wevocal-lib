// 音を 0 から作るダイアログ（WeVocalSynth と WeVocal Studio で共通。訳文はアプリの t を渡す）
import { useEffect, useRef, useState } from 'react'
import { limitedOutput } from '../outputLimit'
import { Box, Button, Checkbox, DialogActions, DialogContent, FormControlLabel, MenuItem, Radio, RadioGroup, Select, Typography } from '@mui/material'
import { enterToSubmit, NumberInput, SliderRow, WindowDialog, pevenFont } from 'pevenmui'
import type { Clip } from '../types'
import { startContext } from '../playback'
import { parseMidi, type MidiFile } from '../midi'
import { PEAK_DB, synthesize, type SynthNote, type Timbre } from '../synth'
import { noteName } from '../notes'

/** このダイアログが使う訳文のキー（アプリの訳文に同じキーを置く） */
export type SynthDialogKey =
  | 'common.cancel'
  | 'common.stop'
  | 'play.preview'
  | 'midi.choose'
  | 'midi.loadFailed'
  | 'midi.noNotes'
  | 'midi.none'
  | 'midi.tempoProject'
  | 'midi.track'
  | 'midi.trackItem'
  | 'process.semitoneUnit'
  | 'synth.create'
  | 'synth.formant'
  | 'synth.hint'
  | 'synth.length'
  | 'synth.midi'
  | 'synth.note'
  | 'synth.sawtooth'
  | 'synth.sine'
  | 'synth.single'
  | 'synth.square'
  | 'synth.timbre'
  | 'synth.title'
  | 'synth.trackName'
  | 'synth.triangle'
  | 'synth.voiceA'
  | 'synth.voiceE'
  | 'synth.voiceI'
  | 'synth.voiceO'
  | 'synth.voiceU'
  | 'synth.volume'
  | 'vibrato.depth'
  | 'vibrato.rate'
  | 'vibrato.secondUnit'
  | 'vibrato.title'

/** 選べる音色（声は母音、楽器は波形） */
const TIMBRES: { value: string; label: SynthDialogKey; timbre: Timbre }[] = [
  { value: 'voice-a', label: 'synth.voiceA', timbre: { kind: 'voice', vowel: 'a' } },
  { value: 'voice-i', label: 'synth.voiceI', timbre: { kind: 'voice', vowel: 'i' } },
  { value: 'voice-u', label: 'synth.voiceU', timbre: { kind: 'voice', vowel: 'u' } },
  { value: 'voice-e', label: 'synth.voiceE', timbre: { kind: 'voice', vowel: 'e' } },
  { value: 'voice-o', label: 'synth.voiceO', timbre: { kind: 'voice', vowel: 'o' } },
  { value: 'sawtooth', label: 'synth.sawtooth', timbre: { kind: 'wave', wave: 'sawtooth' } },
  { value: 'square', label: 'synth.square', timbre: { kind: 'wave', wave: 'square' } },
  { value: 'triangle', label: 'synth.triangle', timbre: { kind: 'wave', wave: 'triangle' } },
  { value: 'sine', label: 'synth.sine', timbre: { kind: 'wave', wave: 'sine' } },
]
/** 1音のときに選べる高さ（C2〜C6） */
const NOTES = Array.from({ length: 49 }, (_, i) => 36 + i)

/** ラベルと入力欄の1行 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Typography sx={{ fontSize: pevenFont('base'), width: 72, flexShrink: 0 }}>{label}</Typography>
      {children}
    </Box>
  )
}

/**
 * 音を0から作る。音色（声の母音・楽器の波形）と、1音か MIDI のメロディかを選んで合成し、新しいトラックにする
 */
export default function SynthDialog(p: {
  /** アプリの訳文（SynthDialogKey のキーを持つ） */
  t: (key: SynthDialogKey, vars?: Record<string, string | number>) => string
  open: boolean
  bpm: number
  onClose: () => void
  onCreate: (clip: Clip, name: string) => void
}) {
  const t = p.t
  const input = useRef<HTMLInputElement>(null)
  const [timbre, setTimbre] = useState('voice-a')
  const [source, setSource] = useState<'single' | 'midi'>('single')
  const [note, setNote] = useState(60)
  const [length, setLength] = useState(2)
  const [midi, setMidi] = useState<{ name: string; file: MidiFile } | null>(null)
  const [track, setTrack] = useState(0)
  const [matchBpm, setMatchBpm] = useState(false)
  const [vibrato, setVibrato] = useState(true)
  const [depth, setDepth] = useState(0.3)
  const [rate, setRate] = useState(5.5)
  const [formant, setFormant] = useState(0)
  const [volume, setVolume] = useState(PEAK_DB)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choice = TIMBRES.find((x) => x.value === timbre) ?? TIMBRES[0]

  // 試聴: 今の設定で合成して鳴らす。設定が同じなら前の結果を使い回す（作成のときも）
  const cache = useRef<{ key: string; clip: Clip } | null>(null)
  const audio = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode } | null>(null)
  const [playing, setPlaying] = useState(false)
  const stop = () => {
    audio.current?.src.stop()
    void audio.current?.ctx.close()
    audio.current = null
    setPlaying(false)
  }
  // 閉じたら止める
  useEffect(() => {
    if (!p.open) stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open])

  const openMidi = async (f: File) => {
    try {
      const file = parseMidi(await f.arrayBuffer())
      if (!file.tracks.length) throw new Error(t('midi.noNotes'))
      setMidi({ name: f.name, file })
      setTrack(0)
      setError(null)
    } catch (e) {
      setMidi(null)
      setError(t('midi.loadFailed', { error: e instanceof Error ? e.message : String(e) }))
    }
  }

  const notes = (): SynthNote[] => {
    if (source === 'single') return [{ note, start: 0, end: length }]
    if (!midi) return []
    const scale = matchBpm && p.bpm > 0 ? midi.file.bpm / p.bpm : 1
    return (midi.file.tracks[track]?.notes ?? []).map((n) => ({ note: n.note, start: n.start * scale, end: n.end * scale }))
  }

  /** 今の設定で合成した音（同じ設定なら前の結果） */
  const render = async () => {
    const list = notes()
    if (!list.length) return null
    const vib = vibrato ? { depth, rate } : null
    const formantShift = choice.timbre.kind === 'voice' ? formant : 0
    const key = JSON.stringify({ list, timbre: choice.timbre, vib, formantShift, volume })
    if (cache.current?.key === key) return cache.current.clip
    const clip = await synthesize(list, { timbre: choice.timbre, vibrato: vib, formantShift, peakDb: volume })
    cache.current = { key, clip }
    return clip
  }

  const preview = async () => {
    if (playing) return stop()
    setBusy(true)
    // AudioContext は音を作る前（操作の直後）に作って動かす。iOS は await の後に作ると無音のままになる
    const ctx = new AudioContext()
    const started = startContext(ctx, 'synth')
    try {
      const clip = await render()
      await started
      if (!clip) return void ctx.close()
      const buf = ctx.createBuffer(1, clip.channels[0].length, clip.sampleRate)
      buf.copyToChannel(clip.channels[0] as Float32Array<ArrayBuffer>, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(limitedOutput(ctx))
      src.onended = () => stop()
      src.start()
      audio.current = { ctx, src }
      setPlaying(true)
    } catch (e) {
      setError(String(e))
      void ctx.close()
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    stop()
    setBusy(true)
    try {
      const clip = await render()
      if (!clip) return
      const what = source === 'single' ? noteName(note) : (midi?.file.tracks[track]?.name ?? 'MIDI')
      p.onCreate(clip, t('synth.trackName', { timbre: t(choice.label), what }))
      p.onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <WindowDialog
      open={p.open}
      onClose={() => !busy && p.onClose()}
      title={t('synth.title')}
      name="synth"
      width={444}
      height={640}
      dialogProps={{ fullWidth: true, maxWidth: 'xs' }}
      onKeyDown={enterToSubmit(() => void create(), !busy && !(source === 'midi' && !midi))}
    >
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Row label={t('synth.timbre')}>
          <Select size="small" fullWidth value={timbre} onChange={(e) => setTimbre(e.target.value)} sx={{ fontSize: pevenFont('base'), '& .MuiSelect-select': { py: 0.5 } }}>
            {TIMBRES.map((x) => (
              <MenuItem key={x.value} value={x.value} sx={{ fontSize: pevenFont('base') }}>
                {t(x.label)}
              </MenuItem>
            ))}
          </Select>
        </Row>
        {choice.timbre.kind === 'voice' && <SliderRow label={t('synth.formant')} value={formant} onChange={setFormant} min={-12} max={12} step={0.5} unit={t('process.semitoneUnit')} />}
        <SliderRow label={t('synth.volume')} value={volume} onChange={setVolume} min={-30} max={0} step={0.5} unit="dB" />
        <RadioGroup value={source} onChange={(e) => setSource(e.target.value as 'single' | 'midi')}>
          <FormControlLabel value="single" control={<Radio size="small" />} label={t('synth.single')} slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }} />
          <FormControlLabel value="midi" control={<Radio size="small" />} label={t('synth.midi')} slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }} />
        </RadioGroup>
        {source === 'single' ? (
          <>
            <Row label={t('synth.note')}>
              <Select
                size="small"
                value={note}
                onChange={(e) => setNote(Number(e.target.value))}
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
            <Row label={t('synth.length')}>
              <NumberInput value={length} onChange={setLength} min={0.1} max={60} step={0.1} unit={t('vibrato.secondUnit')} width={110} ariaLabel={t('synth.length')} />
            </Row>
          </>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button size="small" variant="outlined" onClick={() => input.current?.click()}>
                {t('midi.choose')}
              </Button>
              <Typography className="selectable" sx={{ fontSize: pevenFont('md'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {midi ? midi.name : t('midi.none')}
              </Typography>
              <input
                ref={input}
                type="file"
                accept=".mid,.midi,audio/midi"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void openMidi(f)
                  e.target.value = ''
                }}
              />
            </Box>
            {midi && (
              <>
                <Row label={t('midi.track')}>
                  <Select size="small" fullWidth value={track} onChange={(e) => setTrack(Number(e.target.value))} sx={{ fontSize: pevenFont('base'), '& .MuiSelect-select': { py: 0.5 } }}>
                    {midi.file.tracks.map((tr, i) => (
                      <MenuItem key={i} value={i} sx={{ fontSize: pevenFont('base') }}>
                        {t('midi.trackItem', { name: tr.name, count: tr.notes.length })}
                      </MenuItem>
                    ))}
                  </Select>
                </Row>
                <FormControlLabel
                  control={<Checkbox size="small" checked={matchBpm} onChange={(e) => setMatchBpm(e.target.checked)} />}
                  label={t('midi.tempoProject', { bpm: p.bpm })}
                  slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }}
                />
              </>
            )}
          </>
        )}
        <FormControlLabel
          control={<Checkbox size="small" checked={vibrato} onChange={(e) => setVibrato(e.target.checked)} />}
          label={t('vibrato.title')}
          slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }}
        />
        {vibrato && (
          <>
            <SliderRow label={t('vibrato.depth')} value={depth} onChange={setDepth} min={0} max={2} step={0.05} unit={t('process.semitoneUnit')} />
            <SliderRow label={t('vibrato.rate')} value={rate} onChange={setRate} min={1} max={10} step={0.1} unit="Hz" />
          </>
        )}
        {error && (
          <Typography className="selectable" sx={{ fontSize: pevenFont('md'), color: 'error.main' }}>
            {error}
          </Typography>
        )}
        <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('synth.hint')}</Typography>
      </DialogContent>
      <DialogActions>
        <Button size="small" disabled={busy || (source === 'midi' && !midi)} onClick={() => void preview()} sx={{ mr: 'auto' }}>
          {t(playing ? 'common.stop' : 'play.preview')}
        </Button>
        <Button size="small" disabled={busy} onClick={p.onClose}>
          {t('common.cancel')}
        </Button>
        <Button size="small" disabled={busy || (source === 'midi' && !midi)} onClick={() => void create()}>
          {t('synth.create')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}

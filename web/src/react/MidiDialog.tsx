// MIDI に合わせてピッチの曲線を作るダイアログ（WeVocalSynth と WeVocal Studio で共通。訳文は PitchToolText）
import { useRef, useState } from 'react'
import { Box, Button, Checkbox, FormControlLabel, MenuItem, Radio, RadioGroup, Select, Typography } from '@mui/material'
import { parseMidi, type MidiFile } from '../midi'
import type { MidiFitOptions } from '../pitchTools'
import { NumberInput } from 'pevenmui'
import { SliderRow } from 'pevenmui'
import { ToolDialog, useT, type DialogProps } from './PitchToolDialogs'
import { pevenFont } from 'pevenmui'

/** MIDI の時刻をどう合わせるか（midi: MIDI のテンポのまま / project: 設定の BPM に合わせる） */
type TempoMode = 'midi' | 'project'

/**
 * MIDI の音程をピッチに当てはめる。MIDI ファイルを選び、使うトラック・置く位置・テンポ・移調を決めると、
 * その時刻に鳴っている音符の高さを目標ピッチにする（ほかのピッチの一括操作と同じく、試聴してから適用する）
 */
export function MidiDialog(p: DialogProps<MidiFitOptions> & { bpm: number; defaultOffset: number }) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; midi: MidiFile } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [track, setTrack] = useState(0)
  const [offset, setOffset] = useState<number | null>(null)
  const [tempo, setTempo] = useState<TempoMode>('midi')
  const [transpose, setTranspose] = useState(0)
  const [keepShape, setKeepShape] = useState(true)
  const [strength, setStrength] = useState(1)

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
    p.onRun({
      notes,
      offset: offset ?? p.defaultOffset,
      // 設定の BPM に合わせるときは、MIDI のテンポとの比で時刻を伸び縮みさせる
      timeScale: tempo === 'project' && p.bpm > 0 ? file.midi.bpm / p.bpm : 1,
      transpose,
      keepShape,
      strength,
    })
  }

  return (
    <ToolDialog open={p.open} title={t('midi.title')} hasSelection={p.hasSelection} onClose={p.onClose} onRun={run}>
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography sx={{ fontSize: pevenFont('base'), width: 72, flexShrink: 0 }}>{t('midi.track')}</Typography>
            <Select size="small" fullWidth value={track} onChange={(e) => setTrack(Number(e.target.value))} sx={{ fontSize: pevenFont('base'), '& .MuiSelect-select': { py: 0.5 } }}>
              {file.midi.tracks.map((tr, i) => (
                <MenuItem key={i} value={i} sx={{ fontSize: pevenFont('base') }}>
                  {t('midi.trackItem', { name: tr.name, count: tr.notes.length })}
                </MenuItem>
              ))}
            </Select>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography sx={{ fontSize: pevenFont('base'), width: 72, flexShrink: 0 }}>{t('midi.offset')}</Typography>
            <NumberInput value={offset ?? p.defaultOffset} onChange={setOffset} min={0} max={3600} step={0.01} unit={t('vibrato.secondUnit')} width={110} ariaLabel={t('midi.offset')} />
          </Box>
          <RadioGroup value={tempo} onChange={(e) => setTempo(e.target.value as TempoMode)}>
            <FormControlLabel value="midi" control={<Radio size="small" />} label={t('midi.tempoMidi', { bpm: file.midi.bpm })} slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }} />
            <FormControlLabel value="project" control={<Radio size="small" />} label={t('midi.tempoProject', { bpm: p.bpm })} slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }} />
          </RadioGroup>
          <SliderRow label={t('midi.transpose')} value={transpose} onChange={(v) => setTranspose(Math.round(v))} min={-24} max={24} step={1} unit={t('process.semitoneUnit')} />
          <FormControlLabel
            control={<Checkbox size="small" checked={keepShape} onChange={(e) => setKeepShape(e.target.checked)} />}
            label={t('snap.keepShape')}
            slotProps={{ typography: { sx: { fontSize: pevenFont('base') } } }}
          />
          <SliderRow label={t('snap.strength')} value={Math.round(strength * 100)} onChange={(v) => setStrength(v / 100)} min={0} max={100} step={1} unit="%" />
        </>
      )}
    </ToolDialog>
  )
}

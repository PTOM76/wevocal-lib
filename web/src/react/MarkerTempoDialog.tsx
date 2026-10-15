// マーカーからのテンポを決めるダイアログ（WeVocalSynth と WeVocal Studio で共通。訳文はアプリの t を渡す）
import { useEffect, useState } from 'react'
import { Box, Button, DialogActions, DialogContent, Typography } from '@mui/material'
import { NumberInput, WindowDialog, pevenFont } from 'pevenmui'

/** テンポを持てるマーカー（名前と、ここからのテンポ） */
type Marker = { id: string; name: string; tempo?: { bpm: number; beatsPerBar: number } }

/** このダイアログが使う訳文のキー（アプリの訳文に同じキーを置く） */
export type MarkerTempoKey = 'markerTempo.title' | 'markerTempo.remove' | 'settings.beatsPerBar' | 'common.cancel'

/**
 * マーカーに「ここからのテンポ」を持たせる（テンポが途中で変わる曲）。`marker` が null なら閉じている。
 * 初期値は、そのマーカーのテンポか、なければその位置のテンポ（`current`）
 */
export default function MarkerTempoDialog(p: {
  /** アプリの訳文（MarkerTempoKey のキーを持つ） */
  t: (key: MarkerTempoKey, vars?: Record<string, string | number>) => string
  marker: Marker | null
  current: { bpm: number; beatsPerBar: number }
  onClose: () => void
  onChange: (tempo: Marker['tempo']) => void
}) {
  const t = p.t
  const [bpm, setBpm] = useState(120)
  const [beatsPerBar, setBeatsPerBar] = useState(4)
  const { marker, current } = p
  useEffect(() => {
    if (!marker) return
    setBpm(Math.round((marker.tempo?.bpm ?? current.bpm) * 100) / 100)
    setBeatsPerBar(marker.tempo?.beatsPerBar ?? current.beatsPerBar)
    // 開いたときだけ初期値を入れる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker?.id])
  const done = (tempo: Marker['tempo']) => {
    p.onChange(tempo)
    p.onClose()
  }
  const ok = () => bpm > 0 && done({ bpm, beatsPerBar: Math.max(1, Math.round(beatsPerBar)) })
  return (
    // 設定に従って、別の窓（ポップアップ）にも出せる（PevenMUI の WindowDialog）
    <WindowDialog open={!!marker} onClose={p.onClose} title={t('markerTempo.title', { name: marker?.name ?? '' })} name="markerTempo" width={360} height={280} dialogProps={{ fullWidth: true, maxWidth: 'xs' }} onKeyDown={(e) => e.key === 'Enter' && ok()}>
      <DialogContent>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'auto auto', alignItems: 'center', justifyContent: 'start', columnGap: 2, rowGap: 1, mt: 1 }}>
          <Typography sx={{ fontSize: pevenFont('base') }}>BPM</Typography>
          <NumberInput value={bpm} onChange={setBpm} min={20} max={400} step={0.01} unit="BPM" width={110} ariaLabel="BPM" />
          <Typography sx={{ fontSize: pevenFont('base') }}>{t('settings.beatsPerBar')}</Typography>
          <NumberInput value={beatsPerBar} onChange={(v) => setBeatsPerBar(Math.round(v))} min={1} max={16} step={1} width={110} ariaLabel={t('settings.beatsPerBar')} />
        </Box>
      </DialogContent>
      <DialogActions>
        {/* テンポを外すと、前のテンポがそのまま続く */}
        <Button size="small" color="error" disabled={!marker?.tempo} onClick={() => done(undefined)} sx={{ mr: 'auto' }}>
          {t('markerTempo.remove')}
        </Button>
        <Button size="small" onClick={p.onClose}>
          {t('common.cancel')}
        </Button>
        <Button size="small" disabled={!(bpm > 0)} onClick={ok}>
          OK
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}

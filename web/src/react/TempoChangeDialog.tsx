// テンポの途中の変化を見つけたときに、マーカーを置くかを尋ねるダイアログ（WeVocalSynth と WeVocal Studio で共通。訳文はアプリの t を渡す）
import { Button, DialogActions, DialogContent, List, ListItemButton, Typography } from '@mui/material'
import { WindowDialog, formatTime, pevenFont } from 'pevenmui'
import type { TempoChangeSection } from '../tempoChange'

/** このダイアログが使う訳文のキー（アプリの訳文に同じキーを置く） */
export type TempoChangeKey = 'tempoChange.title' | 'tempoChange.message' | 'tempoChange.keep' | 'tempoChange.adopt'

/**
 * 自動解析で、途中でテンポが変わるのを見つけたときに尋ねる。採用するとテンポのマーカーを置き、見送ると一定のテンポのまま。
 * 行を押すとその位置へ移動する
 */
export default function TempoChangeDialog(p: {
  /** アプリの訳文（TempoChangeKey のキーを持つ） */
  t: (key: TempoChangeKey) => string
  open: boolean
  sections: TempoChangeSection[]
  onSeek: (time: number) => void
  onAdopt: () => void
  onClose: () => void
}) {
  const t = p.t
  return (
    // 設定に従って、別の窓（ポップアップ）にも出せる（PevenMUI の WindowDialog）
    <WindowDialog open={p.open} onClose={p.onClose} title={t('tempoChange.title')} name="tempoChange" width={360} height={360} dialogProps={{ fullWidth: true, maxWidth: 'xs' }}>
      <DialogContent>
        <Typography className="selectable" sx={{ fontSize: pevenFont('base'), mb: 1 }}>
          {t('tempoChange.message')}
        </Typography>
        <List dense disablePadding>
          {p.sections.map((s) => (
            <ListItemButton key={s.time} onClick={() => p.onSeek(s.time)} sx={{ fontSize: pevenFont('base'), gap: 2 }}>
              <span style={{ minWidth: 72, fontVariantNumeric: 'tabular-nums' }}>{formatTime(s.time)}</span>
              <span>{Math.round(s.bpm * 100) / 100} BPM</span>
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={p.onClose}>
          {t('tempoChange.keep')}
        </Button>
        <Button
          size="small"
          onClick={() => {
            p.onAdopt()
            p.onClose()
          }}
        >
          {t('tempoChange.adopt')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}

// トラックのグラフィック EQ のダイアログ（WeVocalSynth と WeVocal Studio で共通。訳文はアプリの t を渡す）
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Switch, ToggleButton, Tooltip, ToggleButtonGroup, Typography } from '@mui/material'
import { pevenFont, usePalette } from 'pevenmui'
import { eqRange, flatEq, isFlatEq, resizeEq, setEqRange, type EqBands, type EqRange, type TrackEq } from '../effects/eq'
import EqGraph from './EqGraph'

/** このダイアログが使う訳文のキー（アプリの訳文に同じキーを置く） */
export type EqDialogKey = 'eq.graph' | 'common.close' | 'eq.apply' | 'eq.applyHelp' | 'eq.bands' | 'eq.bandsN' | 'eq.flat' | 'eq.help' | 'eq.on' | 'eq.pause' | 'eq.play' | 'eq.range' | 'eq.title'

/**
 * トラックのグラフィック EQ。変えた値はすぐ再生に反映され、書き出しにも掛かる。適用するとトラックの音声に書き込む。
 * 開いたまま再生できるように、再生の切り替えも置く
 */
export default function EqDialog(p: {
  /** アプリの訳文（EqDialogKey のキーを持つ） */
  t: (key: EqDialogKey, vars?: Record<string, string | number>) => string
  open: boolean
  trackName: string
  eq: TrackEq
  onChange: (eq: TrackEq) => void
  playing: boolean
  onTogglePlay: () => void
  /** EQ をトラックの音声に書き込む（書き込んだら EQ は平らに戻る。元の音を書き換えないアプリでは渡さない） */
  onApply?: () => void
  busy: boolean
  onClose: () => void
}) {
  const t = p.t
  const { pal } = usePalette()
  const eq = p.eq
  return (
    <Dialog open={p.open} onClose={p.onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontSize: pevenFont('xl'), py: 1.5 }}>{t('eq.title', { name: p.trackName })}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 1 }}>
          <FormControlLabel
            control={<Switch size="small" checked={eq.on} onChange={(e) => p.onChange({ ...eq, on: e.target.checked })} />}
            label={<Typography sx={{ fontSize: pevenFont('base') }}>{t('eq.on')}</Typography>}
          />
          <ToggleButtonGroup size="small" exclusive value={eq.bands} onChange={(_, v: EqBands | null) => v && p.onChange(resizeEq(eq, v))} aria-label={t('eq.bands')}>
            <ToggleButton value={10} sx={{ fontSize: pevenFont('sm'), py: 0.25 }}>
              {t('eq.bandsN', { n: 10 })}
            </ToggleButton>
            <ToggleButton value={31} sx={{ fontSize: pevenFont('sm'), py: 0.25 }}>
              {t('eq.bandsN', { n: 31 })}
            </ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup size="small" exclusive value={eqRange(eq)} onChange={(_, v: EqRange | null) => v && p.onChange(setEqRange(eq, v))} aria-label={t('eq.range')}>
            {([12, 24] as const).map((r) => (
              <ToggleButton key={r} value={r} sx={{ fontSize: pevenFont('sm'), py: 0.25 }}>
                ±{r} dB
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Button size="small" onClick={() => p.onChange({ ...flatEq(eq.bands), on: eq.on, range: eq.range })}>
            {t('eq.flat')}
          </Button>
        </Box>
        <EqGraph
          eq={eq}
          onChange={(gains) => p.onChange({ ...eq, gains })}
          label={t('eq.graph')}
          colors={{ background: pal.action.hover, divider: pal.divider, text: pal.text.primary, textSecondary: pal.text.secondary, line: pal.primary.main, disabled: pal.text.disabled }}
        />
        <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary', mt: 1 }}>{t('eq.help')}</Typography>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={p.onTogglePlay} sx={{ mr: 'auto' }}>
          {p.playing ? t('eq.pause') : t('eq.play')}
        </Button>
        {p.onApply && (
          <Tooltip title={t('eq.applyHelp')}>
            <span>
              <Button size="small" disabled={p.busy || isFlatEq(eq)} onClick={p.onApply}>
                {t('eq.apply')}
              </Button>
            </span>
          </Tooltip>
        )}
        <Button size="small" onClick={p.onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

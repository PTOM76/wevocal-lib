// 音声の書き出しのダイアログ（WeVocalSynth と WeVocal Studio で共通。訳文はアプリの t を渡す）
import { useEffect, useState, type ReactNode } from 'react'
import { Box, Checkbox, FormControlLabel,
  Button,
  DialogActions,
  DialogContent,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { enterToSubmit, WindowDialog, pevenFont } from 'pevenmui'
import { AAC_SAMPLE_RATES, BITRATES, MP3_SAMPLE_RATES, OPUS_SAMPLE_RATE, canEncodeAac, canEncodeOpus, isLossy } from '../export/formats'
import { EXPORT_EXT, type ExportFormat } from '../export/exportAudio'
import type { WavFormat } from '../wav'

import type { FinishOptions } from '../clipEdit'
export type { FinishOptions }

/** このダイアログが使う訳文のキー（アプリの訳文に同じキーを置く） */
export type ExportDialogKey =
  | 'export.title' | 'export.unsupported' | 'export.sampleFormat' | 'export.bitrate' | 'export.sampleRate' | 'export.originalRate'
  | 'export.channels' | 'export.keepChannels' | 'export.target' | 'export.targetMix' | 'export.targetActive' | 'export.range'
  | 'export.folderLabel' | 'export.folderUnset' | 'export.folderBrowse' | 'export.fileName' | 'export.fade' | 'export.fadeNone' | 'export.run'
  | 'volume.normalize' | 'common.whole' | 'common.selection' | 'common.cancel'

/** ダイアログで選んだ設定（範囲は「選択範囲か全体か」だけを持つ） */
export interface ExportSettings {
  fileName: string
  format: ExportFormat
  wavFormat: WavFormat
  kbps: number
  /** 0 は元のサンプルレート */
  sampleRate: number
  mono: boolean
  selectionOnly: boolean
  /** 全トラックを混ぜて書き出す（偽なら選んでいるトラックだけ）。ミュート・ソロとフェーダーに従う */
  mix: boolean
}

interface Props {
  /** アプリの訳文（ExportDialogKey のキーを持つ） */
  t: (key: ExportDialogKey, vars?: Record<string, string | number>) => string
  open: boolean
  onClose: () => void
  baseName: string
  sourceRate: number
  sourceChannels: number
  hasSelection: boolean
  /** トラックの数（2本以上なら「書き出す対象」を出す） */
  trackCount: number
  busy: boolean
  progress: number
  /** win は操作したウィンドウ（ダイアログを別ウィンドウで開いているとき、保存先の画面をそこから出すため） */
  onExport: (s: ExportSettings, win?: Window | null) => void
  /** 保存先のフォルダー（PWA。書き出すときに保存先を聞かず、ここへ保存する）。選び直しは `win` の窓から出す */
  folder?: { name: string | null; choose: (win: Window | null) => void }
  /** 選んでいるトラックだけを対象にして開く（トラックの右クリックから） */
  activeOnly?: boolean
  /** 仕上げ（ノーマライズ、両端のフェード）。設定に覚える */
  finish: FinishOptions
  onFinishChange: (f: FinishOptions) => void
}

/** 両端のフェードの長さの選択肢（ms。0 はなし） */
const FADES = [0, 5, 10, 20, 50]

/** 形式の並びとボタンの名前（FLAC はロスレス、ほかは圧縮） */
const FORMATS: ExportFormat[] = ['wav', 'flac', 'mp3', 'opus', 'aac']
const FORMAT_NAME: Record<ExportFormat, string> = { wav: 'WAV', flac: 'FLAC', mp3: 'MP3', opus: 'Opus', aac: 'AAC' }
const RATES = [22050, 32000, 44100, 48000, 96000]

/** ラベル付きのセレクトボックス（VideoExportDialog でも使う） */
export function Choice<T extends string | number>(p: { label: string; value: T; options: [T, ReactNode][]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <FormControl size="small" fullWidth disabled={p.disabled}>
      <InputLabel>{p.label}</InputLabel>
      <Select label={p.label} value={p.value} onChange={(e) => p.onChange(e.target.value as T)}>
        {p.options.map(([v, text]) => (
          <MenuItem key={v} value={v}>
            {text}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}

/** 音声ファイルの書き出し。形式・音質・サンプルレート・チャンネル・範囲を選ぶ */
export default function ExportDialog(p: Props) {
  const t = p.t
  const [s, setS] = useState<ExportSettings>({
    fileName: '',
    format: 'wav',
    wavFormat: 'pcm16',
    kbps: 192,
    sampleRate: 0,
    mono: false,
    selectionOnly: false,
    mix: true,
  })
  // WebCodecs で書き出す形式が、このブラウザで使えるか
  const [codecOk, setCodecOk] = useState({ opus: false, aac: false })
  const set = (patch: Partial<ExportSettings>) => setS((v) => ({ ...v, ...patch }))

  // 開くたびにファイル名と範囲を今の状態に合わせ、Opus が使えるかを確かめる
  useEffect(() => {
    if (!p.open) return
    setS((v) => ({ ...v, fileName: p.baseName, selectionOnly: p.hasSelection, ...(p.activeOnly ? { mix: false } : {}) }))
    const ch = Math.min(2, p.sourceChannels)
    void Promise.all([canEncodeOpus(ch), canEncodeAac(ch)]).then(([opus, aac]) => setCodecOk({ opus, aac }))
  }, [p.open, p.baseName, p.hasSelection, p.sourceChannels, p.activeOnly])

  // 形式ごとに選べるサンプルレートが違う（MP3 は 32/44.1/48kHz、AAC は 44.1/48kHz、Opus は 48kHz 固定）
  const fixedRates = s.format === 'mp3' ? MP3_SAMPLE_RATES : s.format === 'aac' ? AAC_SAMPLE_RATES : null
  const rateOptions: [number, string][] =
    s.format === 'opus'
      ? [[OPUS_SAMPLE_RATE, '48000 Hz']]
      : [
          ...(!fixedRates || fixedRates.includes(p.sourceRate)
            ? [[0, t('export.originalRate', { rate: p.sourceRate })] as [number, string]]
            : []),
          ...(fixedRates ?? RATES).map((r): [number, string] => [r, `${r} Hz`]),
        ]
  const rate = rateOptions.some(([v]) => v === s.sampleRate) ? s.sampleRate : rateOptions[0][0]
  const kbpsOptions = isLossy(s.format) ? BITRATES[s.format] : []
  const kbps = kbpsOptions.includes(s.kbps) ? s.kbps : 128
  const unsupported = (['opus', 'aac'] as const).filter((f) => !codecOk[f]).map((f) => FORMAT_NAME[f])

  return (
    <WindowDialog
      open={p.open}
      onClose={p.busy ? undefined : p.onClose}
      title={t('export.title')}
      name="export"
      width={444}
      height={600}
      dialogProps={{ fullWidth: true, maxWidth: 'xs' }}
      onKeyDown={(e) => {
        const win = e.currentTarget.ownerDocument.defaultView
        enterToSubmit(() => p.onExport({ ...s, sampleRate: rate, kbps }, win), !p.busy && !!s.fileName.trim())(e)
      }}
    >
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={s.format}
            onChange={(_, v: ExportFormat | null) => v && set({ format: v })}
          >
            {FORMATS.map((f) => (
              <ToggleButton key={f} value={f} disabled={(f === 'opus' || f === 'aac') && !codecOk[f]}>
                {FORMAT_NAME[f]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {unsupported.length > 0 && (
            <Typography className="selectable" variant="caption" color="text.secondary" sx={{ mt: '4px !important' }}>
              {t('export.unsupported', { formats: unsupported.join(', ') })}
            </Typography>
          )}

          {!isLossy(s.format) ? (
            <Choice
              label={t('export.sampleFormat')}
              value={s.format === 'flac' && s.wavFormat === 'float32' ? 'pcm24' : s.wavFormat}
              onChange={(v) => set({ wavFormat: v })}
              options={[
                ['pcm16', '16-bit PCM'],
                ['pcm24', '24-bit PCM'],
                // FLAC は整数だけ
                ...(s.format === 'wav' ? [['float32', '32-bit float'] as [WavFormat, string]] : []),
              ]}
            />
          ) : (
            <Choice
              label={t('export.bitrate')}
              value={kbps}
              onChange={(v) => set({ kbps: v })}
              options={kbpsOptions.map((k) => [k, `${k} kbps`])}
            />
          )}
          <Choice
            label={t('export.sampleRate')}
            value={rate}
            onChange={(v) => set({ sampleRate: v })}
            options={rateOptions}
            disabled={s.format === 'opus'}
          />
          <Choice
            label={t('export.channels')}
            value={s.mono ? 'mono' : 'keep'}
            onChange={(v) => set({ mono: v === 'mono' })}
            options={[
              ['keep', p.sourceChannels === 1 ? 'Mono' : t('export.keepChannels', { n: p.sourceChannels })],
              ['mono', 'Mono'],
            ]}
          />
          {p.trackCount > 1 && (
            <Choice
              label={t('export.target')}
              value={s.mix ? 'mix' : 'active'}
              onChange={(v) => set({ mix: v === 'mix' })}
              options={[
                ['mix', t('export.targetMix')],
                ['active', t('export.targetActive')],
              ]}
            />
          )}
          <Choice
            label={t('export.range')}
            value={s.selectionOnly ? 'selection' : 'whole'}
            onChange={(v) => set({ selectionOnly: v === 'selection' })}
            options={[
              ['whole', t('common.whole')],
              ['selection', t('common.selection')],
            ]}
            disabled={!p.hasSelection}
          />
          {/* 編集ソフトの書き出しと同じく、保存先フォルダーとファイル名を決めてから書き出す（フォルダーは覚えておく） */}
          {p.folder && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TextField
                size="small"
                fullWidth
                label={t('export.folderLabel')}
                value={p.folder.name ?? t('export.folderUnset')}
                slotProps={{ input: { readOnly: true } }}
              />
              <Button variant="outlined" disabled={p.busy} onClick={(e) => p.folder?.choose(e.currentTarget.ownerDocument.defaultView)} sx={{ flexShrink: 0 }}>
                {t('export.folderBrowse')}
              </Button>
            </Stack>
          )}
          <TextField
            size="small"
            label={t('export.fileName')}
            value={s.fileName}
            onChange={(e) => set({ fileName: e.target.value })}
            slotProps={{ input: { endAdornment: <Typography color="text.secondary">{EXPORT_EXT[s.format]}</Typography> } }}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <FormControlLabel
              sx={{ flex: 1, m: 0 }}
              control={<Checkbox size="small" checked={p.finish.normalize} onChange={(e) => p.onFinishChange({ ...p.finish, normalize: e.target.checked })} />}
              label={<Typography sx={{ fontSize: pevenFont('base') }}>{t('volume.normalize')}</Typography>}
            />
            <Box sx={{ width: 150 }}>
              <Choice
                label={t('export.fade')}
                value={p.finish.fadeMs}
                onChange={(v) => p.onFinishChange({ ...p.finish, fadeMs: v })}
                options={FADES.map((ms): [number, string] => [ms, ms ? `${ms} ms` : t('export.fadeNone')])}
              />
            </Box>
          </Stack>
          {p.busy && <LinearProgress variant="determinate" value={p.progress * 100} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onClose} disabled={p.busy}>
          {t('common.cancel')}
        </Button>
        <Button
          disabled={p.busy || !s.fileName.trim()}
          onClick={(e) => p.onExport({ ...s, sampleRate: rate, kbps }, e.currentTarget.ownerDocument.defaultView)}
        >
          {t('export.run')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}

// プラグインのつまみの自動の画面（params から SliderRow と選択を並べる。WeVocalSynth と WeVocal Studio で共通）
import { Box } from '@mui/material'
import { SliderRow } from 'pevenmui'
import { fxText } from '../plugins/host'
import type { FxPlugin } from '../../../plugin-sdk'
import { Choice } from './ExportDialog'

/** つまみの単位の表示。% は 0〜1 の値を 0〜100 で出す */
const scale = (unit?: string) => (unit === '%' ? 100 : 1)

export default function FxParams(p: { plugin: FxPlugin; values: Record<string, number>; lang: string; onChange: (id: string, v: number) => void }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {p.plugin.manifest.params.map((d) => {
        const label = fxText(p.plugin, d.name, p.lang)
        const v = p.values[d.id] ?? d.default
        if (d.choices)
          return <Choice key={d.id} label={label} value={v} options={d.choices.map((c, i) => [i, fxText(p.plugin, c, p.lang)])} onChange={(x) => p.onChange(d.id, x)} />
        const k = scale(d.unit)
        const step = (d.step ?? (d.max - d.min) / 100) * k
        return (
          <SliderRow
            key={d.id}
            label={label}
            value={v * k}
            min={d.min * k}
            max={d.max * k}
            step={step}
            unit={d.unit}
            log={d.log}
            defaultValue={d.default * k}
            onChange={(x) => p.onChange(d.id, x / k)}
          />
        )
      })}
    </Box>
  )
}

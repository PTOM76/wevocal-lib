// プラグインのつまみの自動の画面（params から SliderRow、選択、トグルを並べる。WeVocalSynth と WeVocal Studio で共通）
import { Box, Checkbox, FormControlLabel, IconButton } from '@mui/material'
import { SliderRow } from 'pevenmui'
import { fxText } from '../plugins/host'
import type { FxPlugin } from '../../../plugin-sdk'
import { Choice } from './ExportDialog'

/** つまみの単位の表示。% は 0〜1 の値を 0〜100 で出す */
const scale = (unit?: string) => (unit === '%' ? 100 : 1)

/** つまみの行に付けるオートメーションの指定（トラックの欄に出す線にするつまみを選ぶ） */
export interface FxAutomation {
  /** 今、時間軸に出しているつまみ（このエフェクトのもの。なければ null） */
  lane: string | null
  /** 点があるつまみ */
  has: ReadonlySet<string>
  /** つまみを時間軸に出す（同じものをもう一度押すと外す） */
  onLane: (param: string) => void
  /** ボタンの説明 */
  title: string
}

export default function FxParams(p: { plugin: FxPlugin; values: Record<string, number>; lang: string; onChange: (id: string, v: number) => void; automation?: FxAutomation }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {p.plugin.manifest.params.map((d) => {
        const row = (el: React.ReactNode) => (p.automation ? <AutoRow key={d.id} a={p.automation} id={d.id}>{el}</AutoRow> : el)
        const label = fxText(p.plugin, d.name, p.lang)
        const v = p.values[d.id] ?? d.default
        if (d.toggle) return row(<FormControlLabel key={d.id} label={label} control={<Checkbox size="small" checked={v >= 0.5} onChange={(e) => p.onChange(d.id, e.target.checked ? 1 : 0)} />} />)
        if (d.choices)
          return row(<Choice key={d.id} label={label} value={v} options={d.choices.map((c, i) => [i, fxText(p.plugin, c, p.lang)])} onChange={(x) => p.onChange(d.id, x)} />)
        const k = scale(d.unit)
        const step = (d.step ?? (d.max - d.min) / 100) * k
        return row(
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
          />,
        )
      })}
    </Box>
  )
}

/** つまみの行の右に、オートメーションのボタン（A）を付ける。点があれば色を付け、時間軸に出していれば強調する */
function AutoRow(p: { a: FxAutomation; id: string; children: React.ReactNode }) {
  const on = p.a.lane === p.id
  const has = p.a.has.has(p.id)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>{p.children}</Box>
      <IconButton size="small" title={p.a.title} aria-pressed={on} onClick={() => p.a.onLane(p.id)} sx={{ width: 24, height: 24, fontSize: 12, color: on ? 'primary.main' : has ? 'warning.main' : 'text.disabled', border: on ? 1 : 0, borderColor: 'primary.main' }}>
        A
      </IconButton>
    </Box>
  )
}

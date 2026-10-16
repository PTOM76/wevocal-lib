// 標準のプラグイン wevocal.eq（今のグラフィック EQ を包む）と、保存した EQ との読み替え
import { createLiveEq, disconnectLiveEq, updateLiveEq, type EqBands, type EqRange, type TrackEq } from '../effects/eq'
import type { FxPlugin, FxSlot, ParamDef, PluginManifest } from '../../../plugin-sdk'

export const EQ_ID = 'wevocal.eq'

const bandParams: ParamDef[] = Array.from({ length: 31 }, (_, i) => ({ id: `b${i}`, name: `param.b${i}`, min: -24, max: 24, default: 0, step: 0.1, unit: 'dB' as const }))

export const eqManifest: PluginManifest = {
  id: EQ_ID,
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [
    { id: 'bands', name: 'param.bands', min: 0, max: 1, default: 0, choices: ['bands.10', 'bands.31'] },
    { id: 'range', name: 'param.range', min: 0, max: 1, default: 0, choices: ['range.12', 'range.24'] },
    ...bandParams,
  ],
  tail: 0,
}

/** 値の表から EQ にする（帯の数と上限で丸める） */
export function valuesToEq(values: Record<string, number>, on: boolean): TrackEq {
  const bands: EqBands = values.bands === 1 ? 31 : 10
  const range: EqRange = values.range === 1 ? 24 : 12
  const gains = Array.from({ length: bands }, (_, i) => Math.max(-range, Math.min(range, Number(values[`b${i}`]) || 0)))
  return { bands, gains, on, ...(range === 24 ? { range } : {}) }
}

/** EQ を値の表にする */
export function eqToValues(eq: TrackEq): Record<string, number> {
  const v: Record<string, number> = { bands: eq.bands === 31 ? 1 : 0, range: eq.range === 24 ? 1 : 0 }
  for (const [i, g] of eq.gains.entries()) v[`b${i}`] = g
  return v
}

/** 古い保存の eq を FX の 1 項目にする（Studio と Synth の読み込みで共通） */
export const eqToSlot = (eq: TrackEq): FxSlot => ({ plugin: EQ_ID, version: eqManifest.version, on: eq.on, values: eqToValues(eq) })

/** FX の 1 項目から EQ にする */
export const slotToEq = (s: FxSlot): TrackEq => valuesToEq(s.values, s.on)

export const eqPlugin: FxPlugin = {
  manifest: eqManifest,
  lang: {
    ja_jp: { name: 'WevEQ', description: '周波数帯ごとの強さを調整します（10 帯か 31 帯のグラフィック EQ）', keywords: 'グラフィック EQ', 'param.bands': '帯の数', 'param.range': '上限', 'bands.10': '10 帯', 'bands.31': '31 帯', 'range.12': '±12 dB', 'range.24': '±24 dB' },
    en_us: { name: 'WevEQ', description: 'Adjusts the level of each frequency band (10 or 31-band graphic EQ).', 'param.bands': 'Bands', 'param.range': 'Range', 'bands.10': '10 bands', 'bands.31': '31 bands', 'range.12': '±12 dB', 'range.24': '±24 dB' },
    ko_kr: { name: 'WevEQ', keywords: '그래픽 EQ', 'param.bands': '밴드 수', 'param.range': '상한', 'bands.10': '10밴드', 'bands.31': '31밴드', 'range.12': '±12 dB', 'range.24': '±24 dB' },
    zh_cn: { name: 'WevEQ', keywords: '图示均衡器', 'param.bands': '频段数', 'param.range': '上限', 'bands.10': '10 段', 'bands.31': '31 段', 'range.12': '±12 dB', 'range.24': '±24 dB' },
    zh_tw: { name: 'WevEQ', keywords: '圖形等化器', 'param.bands': '頻段數', 'param.range': '上限', 'bands.10': '10 段', 'bands.31': '31 段', 'range.12': '±12 dB', 'range.24': '±24 dB' },
  },
  create(ctx, values, _host, on = true) {
    let isOn = on
    let cur = values
    const n = createLiveEq(ctx, valuesToEq(values, on))
    const apply = () => updateLiveEq(n, valuesToEq(cur, isOn))
    return {
      input: n.input,
      output: n.output,
      update: (v) => {
        cur = v
        apply()
      },
      setOn: (o) => {
        isOn = o
        apply()
      },
      dispose: () => disconnectLiveEq(n),
    }
  },
}


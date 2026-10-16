// オートメーション（エフェクトのつまみを曲の時間に沿って変える）。点の評価と、つまみの値と縦の位置の換算
import type { AutoPoint, FxSlot, ParamDef } from '../../../plugin-sdk'
import { findPlugin, migrateValues } from './host'

/** 時刻 t の値。点の間は直線（選択肢のつまみは次の点まで保つ）。端より外は端の値。点がなければ def */
export function autoValueAt(points: AutoPoint[] | undefined, t: number, def: number, step = false): number {
  if (!points?.length) return def
  if (t <= points[0].t) return points[0].v
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (t <= b.t) return step || b.t === a.t ? a.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t)
  }
  return points[points.length - 1].v
}

/** オートメーションの点を持つ項目があるか */
export const hasAutomation = (slots: FxSlot[] | undefined) => !!slots?.some((s) => s.on && s.auto && Object.values(s.auto).some((p) => p.length))

/** 項目の値に、時刻 t のオートメーションの値を重ねたもの（点のあるつまみだけ置き換える）。無ければ同じものを返す */
export function automatedSlots(slots: FxSlot[], t: number): FxSlot[] {
  if (!hasAutomation(slots)) return slots
  return slots.map((s) => {
    if (!s.on || !s.auto) return s
    const pl = findPlugin(s.plugin)
    if (!pl) return s
    const values = { ...migrateValues(pl.manifest, s.values) }
    for (const d of pl.manifest.params) {
      const pts = s.auto[d.id]
      if (pts?.length) values[d.id] = autoValueAt(pts, t, values[d.id] ?? d.default, !!d.choices)
    }
    return { ...s, values }
  })
}

/** つまみの値から縦の位置（0 が上、1 が下）。対数のつまみは対数で */
export function paramToFrac(d: ParamDef, v: number): number {
  const x = d.log ? Math.log(Math.max(v, d.min) / d.min) / Math.log(d.max / d.min) : (v - d.min) / (d.max - d.min || 1)
  return 1 - Math.max(0, Math.min(1, x))
}

/** 縦の位置からつまみの値（範囲に収め、刻みで丸める。選択肢は整数） */
export function fracToParam(d: ParamDef, frac: number): number {
  const x = Math.max(0, Math.min(1, 1 - frac))
  const v = d.log ? d.min * Math.exp(x * Math.log(d.max / d.min)) : d.min + x * (d.max - d.min)
  const stepped = d.choices ? Math.round(v) : d.step ? Math.round(v / d.step) * d.step : v
  return Math.max(d.min, Math.min(d.max, +stepped.toPrecision(6)))
}

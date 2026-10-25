// オートメーションの点の評価（時刻の値）。プラグインの一覧を読まないので、Worker（plugins/stream）からも使える
import type { AutoPoint } from '../../../plugin-sdk'

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

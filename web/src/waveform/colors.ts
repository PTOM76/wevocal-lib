/** 波形の描画に使う色。アプリのテーマから作って渡す */
export interface WaveColors {
  /** 再生位置の線 */
  text: string
  /** 目盛りの文字、ほかのトラックの波形 */
  textSecondary: string
  /** 区切り線、中央線 */
  divider: string
  /** 波形 */
  wave: string
  /** 選択範囲 */
  selection: string
}

/** 選択範囲の色（ライト / ダーク） */
export const SELECTION_LIGHT = '#0097A7'
export const SELECTION_DARK = '#4DD0E1'

/** 色（#rgb、#rrggbb、rgb()、rgba()）に不透明度 `a` を付ける。読めない形式はそのまま返す */
export function alpha(color: string, a: number) {
  const c = color.trim()
  if (c.startsWith('#')) {
    const hex = c.length === 4 ? c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(1, 7)
    const n = parseInt(hex, 16)
    if (Number.isNaN(n)) return color
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
  }
  const m = /^rgba?\(([^,]+),([^,]+),([^,)]+)/.exec(c)
  return m ? `rgba(${m[1].trim()}, ${m[2].trim()}, ${m[3].trim()}, ${a})` : color
}

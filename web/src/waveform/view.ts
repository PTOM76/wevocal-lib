/** 表示範囲（秒） */
export interface View {
  start: number
  dur: number
}

/** 時刻（秒）を、幅 `width` の Canvas の x 座標にする */
export const timeToX = (width: number, view: View, t: number) => ((t - view.start) / view.dur) * width

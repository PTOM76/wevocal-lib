// 元に戻す、やり直すの状態（過去、今、未来）と、その動かし方。React を使わない純粋な関数で、1 段の中身はアプリが決める
export interface History<S> {
  past: S[]
  present: S
  future: S[]
}

export const newHistory = <S>(present: S): History<S> => ({ past: [], present, future: [] })

/**
 * 今を next にする。未来は捨てる。limit を超えた古い段も捨てる。
 * merged なら過去には積まず、今だけを置き換える（ドラッグやスライダーの続きを 1 段にまとめる）
 */
export function commitHistory<S>(h: History<S>, next: S, limit: number, merged = false): History<S> {
  return { past: merged ? h.past : [...h.past, h.present].slice(-limit), present: next, future: [] }
}

export function undoHistory<S>(h: History<S>): History<S> {
  return h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h
}

export function redoHistory<S>(h: History<S>): History<S> {
  return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h
}

/** 全部の段（古い順）の index 番目へ行く。範囲の外なら動かさない（操作履歴の一覧から使う） */
export function gotoHistory<S>(h: History<S>, index: number): History<S> {
  const all = historySteps(h)
  if (index < 0 || index >= all.length) return h
  return { past: all.slice(0, index), present: all[index], future: all.slice(index + 1) }
}

/** 全部の段（古い順）。今の位置は past の長さ */
export const historySteps = <S>(h: History<S>): S[] => [...h.past, h.present, ...h.future]

// 元に戻す、やり直すを持つストア（React の外にあり、変わったら購読している所へ知らせる）。変更は commit か、ドラッグ中のトランザクション（begin）で通す
import { commitHistory, gotoHistory, newHistory, redoHistory, undoHistory, type History } from './history'

/** ドラッグやスライダーのように、途中の変化を 1 つの操作として履歴に積むもの。commit か cancel で終わる */
export interface Transaction<S> {
  /** 今を next にする（履歴は 1 段のまま。途中経過は画面に出る） */
  update: (next: (present: S) => S) => void
  /** 確定する */
  commit: () => void
  /** 取り消す（始める前の状態に戻る） */
  cancel: () => void
}

export interface HistoryStore<S> {
  get: () => History<S>
  subscribe: (listener: () => void) => () => void
  /** 今の中身（S）を変える。同じものを返したら何もしない。merge が前と同じなら、履歴を 1 段にまとめる（update の第 2 引数が true） */
  commit: (update: (present: S, merged: boolean) => S, merge?: string) => void
  /** 履歴に積まずに今を変える（操作ではないもの。プラグインが自分で知らせた状態など）。同じものを返したら何もしない */
  replacePresent: (update: (present: S) => S) => void
  /** 続けての変更のまとまりを切る */
  endMerge: () => void
  /** merge の続けての変更を、まとめて取り消す（ドラッグ中の Esc）。始める前の状態に戻る。取り消すものがなければ false */
  cancelMerge: (merge: string) => boolean
  undo: () => void
  redo: () => void
  /** 全部の段（古い順）の index 番目へ行く */
  goto: (index: number) => void
  /** 履歴を消して、present から始め直す */
  reset: (present: S) => void
  /** トランザクションを始める */
  begin: () => Transaction<S>
}

/** limit は元に戻せる回数（設定で変わるので、そのたびに読む） */
export function createHistoryStore<S>(initial: S, limit: () => number): HistoryStore<S> {
  let state = newHistory(initial)
  let lastMerge: string | null = null
  // 今の merge の続きを始める前の状態（cancelMerge で戻る先）
  let mergeBase: History<S> | null = null
  const listeners = new Set<() => void>()
  const set = (next: History<S>) => {
    if (next === state) return
    state = next
    for (const l of [...listeners]) l()
  }

  const store: HistoryStore<S> = {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    commit(update, merge) {
      const merged = merge !== undefined && merge === lastMerge
      if (!merged) mergeBase = null
      lastMerge = merge ?? null
      const next = update(state.present, merged)
      if (next === state.present) return
      mergeBase ??= state
      set(commitHistory(state, next, limit(), merged))
    },
    replacePresent(update) {
      const next = update(state.present)
      if (next !== state.present) set({ ...state, present: next })
    },
    endMerge() {
      lastMerge = null
      mergeBase = null
    },
    cancelMerge(merge) {
      const base = mergeBase
      if (merge !== lastMerge || !base) return false
      lastMerge = null
      mergeBase = null
      set(base)
      return true
    },
    undo() {
      lastMerge = null
      mergeBase = null
      set(undoHistory(state))
    },
    redo() {
      lastMerge = null
      mergeBase = null
      set(redoHistory(state))
    },
    goto(index) {
      lastMerge = null
      mergeBase = null
      set(gotoHistory(state, index))
    },
    reset(present) {
      lastMerge = null
      mergeBase = null
      set(newHistory(present))
    },
    begin() {
      lastMerge = null
      const base = state
      let open = true
      return {
        update(next) {
          if (!open) return
          const present = next(state.present)
          if (present !== state.present) set(commitHistory(base, present, limit()))
        },
        commit() {
          open = false
        },
        cancel() {
          if (!open) return
          open = false
          set(base)
        },
      }
    },
  }
  return store
}

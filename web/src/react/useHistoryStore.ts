// 履歴のストアを React から読む（今の中身が変わったときだけ描き直す）
import { useSyncExternalStore } from 'react'
import type { History } from '../history'
import type { HistoryStore } from '../historyStore'

/** ストアの全体（過去、今、未来）。操作履歴の一覧や、元に戻せるかの判定に使う */
export const useHistory = <S>(store: HistoryStore<S>): History<S> => useSyncExternalStore(store.subscribe, store.get)

/** 今の中身 */
export const usePresent = <S>(store: HistoryStore<S>): S => useHistory(store).present

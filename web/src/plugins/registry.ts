// 導入したプラグインの一覧（実行中の登録簿）。画面は subscribe で変わったことを知る
import type { FxPlugin } from '../../../plugin-sdk'

let installed: FxPlugin[] = []
let version = 0
const listeners = new Set<() => void>()

export const installedPlugins = () => installed

/** 一覧を置き換える */
export function setInstalledPlugins(list: FxPlugin[]) {
  installed = list
  version++
  for (const l of listeners) l()
}

/** 変わったら呼ぶ（useSyncExternalStore の subscribe） */
export function subscribePlugins(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** 変わるたびに増える数（useSyncExternalStore の snapshot） */
export const pluginsVersion = () => version

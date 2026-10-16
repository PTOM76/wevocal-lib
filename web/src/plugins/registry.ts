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

// --- 導入したプラグインの負荷（再生中の AudioContext で測る。ノードの組み直しには関係しないので、一覧の版とは別に持つ） ---

const loads = new Map<string, number>()
const overloaded = new Set<string>()
let loadVer = 0
const loadListeners = new Set<() => void>()
const notifyLoad = () => {
  loadVer++
  for (const l of loadListeners) l()
}

/** プラグイン id の処理時間の割合（1 が 128 サンプルを作る時間いっぱい）。測れていなければ undefined */
export const loadOf = (id: string) => loads.get(id)
/** 重くて自動で素通しにしているか */
export const isOverloaded = (id: string) => overloaded.has(id)

export function reportLoad(id: string, ratio: number) {
  loads.set(id, ratio)
  notifyLoad()
}

export function setOverloaded(id: string, on: boolean) {
  if (on === overloaded.has(id)) return
  if (on) overloaded.add(id)
  else overloaded.delete(id)
  notifyLoad()
}

export function subscribeLoad(l: () => void) {
  loadListeners.add(l)
  return () => void loadListeners.delete(l)
}
export const loadVersion = () => loadVer

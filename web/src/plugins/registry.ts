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

/** 再生の AudioContext で動いている processor（外から足した FX と音源）の数。止め忘れて溜まっていないかをデバッグ表示で見る */
let processors = 0
export const liveProcessors = () => processors
export const countProcessor = (d: number) => void (processors += d)

/** 測った値を消す（止めたとき。止める前の値が残って、まだ重いように見えないように） */
export function clearLoad(id: string) {
  if (loads.delete(id)) notifyLoad()
}

// --- 全体の負荷（ブラウザが測る AudioContext の負荷）で守る。プラグインごとの値は推定なので、素通しにするかは全体の負荷で決める ---

/** 全体の負荷で素通しにできる processor（再生の AudioContext の FX） */
export interface LoadGuard {
  /** 推定の負荷（どれを止めるかを選ぶためだけに使う）。測れていなければ undefined */
  load(): number | undefined
  /** 今処理しているか */
  active(): boolean
  /** 重すぎるので素通しにする */
  bypass(): void
}
const guards = new Set<LoadGuard>()
export const addLoadGuard = (g: LoadGuard) => {
  guards.add(g)
  return () => void guards.delete(g)
}

/** 全体の負荷がこれを超える報告が TOTAL_COUNT 回続いたら、一番重い processor を素通しにする（その processor が SHARE 以上を使っているときだけ。ほかが原因なら止めても軽くならない） */
const SHARE = 0.2
const TOTAL_LIMIT = 0.9
const TOTAL_COUNT = 2
let totalLoad: number | undefined
let totalStreak = 0
/** ブラウザが測った全体の負荷（0〜1）。測れないブラウザでは undefined */
export const renderLoad = () => totalLoad

export function reportTotalLoad(load: number) {
  totalLoad = load
  totalStreak = load > TOTAL_LIMIT ? totalStreak + 1 : 0
  if (totalStreak >= TOTAL_COUNT) {
    totalStreak = 0
    const heaviest = [...guards].filter((g) => g.active() && (g.load() ?? 0) >= SHARE).sort((a, b) => b.load()! - a.load()!)[0]
    heaviest?.bypass()
  }
  notifyLoad()
}

export function subscribeLoad(l: () => void) {
  loadListeners.add(l)
  return () => void loadListeners.delete(l)
}
export const loadVersion = () => loadVer

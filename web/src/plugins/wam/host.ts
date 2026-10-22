// WebAudio Modules 2.0 を読み込む土台。ホストの初期化（AudioContext ごとに 1 回）と、モジュールの読み込み、インスタンスの生成
import { initializeWamHost } from '@webaudiomodules/sdk'

/** 使う WAM の API の範囲（SDK の型は JS のものなので、使う分だけ宣言する） */
export interface WamParamInfo {
  id: string
  label?: string
  type?: 'float' | 'int' | 'boolean' | 'choice'
  defaultValue: number
  minValue: number
  maxValue: number
  discreteStep?: number
  choices?: string[]
  units?: string
}
/** WamNode（パラメーターの API を持つ）か、ただの AudioNode（AudioParam を持つだけの WAM もある） */
export interface WamNodeLike extends AudioNode {
  getParameterInfo?(...ids: string[]): Promise<Record<string, WamParamInfo>>
  getParameterValues?(normalized: boolean, ...ids: string[]): Promise<Record<string, { id: string; value: number }>>
  setParameterValues?(updates: Record<string, { id: string; value: number; normalized: boolean }>): Promise<void>
  scheduleEvents?(...events: { type: string; time?: number; data?: unknown }[]): Promise<void>
  getCompensationDelay?(): Promise<number>
  getState?(): Promise<unknown>
  setState?(state: unknown): Promise<void>
  destroy?(): void
}
export interface WamInstance {
  audioNode: WamNodeLike
  /** WAM 自身の画面（このページの DOM に出す） */
  createGui?(): Promise<HTMLElement>
  destroyGui?(gui: HTMLElement): void
  descriptor: { name?: string; vendor?: string; version?: string; identifier?: string; isInstrument?: boolean; hasAudioInput?: boolean }
}
interface WamModule {
  createInstance(groupId: string, ctx: BaseAudioContext, state?: unknown): Promise<WamInstance>
}

/** AudioContext ごとのホストの初期化 */
const hosts = new WeakMap<BaseAudioContext, Promise<string>>()
const hostGroup = (ctx: BaseAudioContext) => {
  let p = hosts.get(ctx)
  if (!p) hosts.set(ctx, (p = (initializeWamHost(ctx) as Promise<[string, string]>).then(([id]) => id)))
  return p
}

/** URL ごとのモジュール（同じものを二度読まない） */
const modules = new Map<string, Promise<WamModule>>()
export function loadWamModule(url: string): Promise<WamModule> {
  let p = modules.get(url)
  if (!p) {
    p = import(/* @vite-ignore */ url).then((m: { default?: WamModule }) => {
      if (typeof m.default?.createInstance !== 'function') throw new Error('not a WAM')
      return m.default
    })
    p.catch(() => modules.delete(url))
    modules.set(url, p)
  }
  return p
}

/** ctx にインスタンスを作る */
export async function createWam(ctx: BaseAudioContext, url: string): Promise<WamInstance> {
  const [mod, group] = await Promise.all([loadWamModule(url), hostGroup(ctx)])
  return mod.createInstance(group, ctx)
}

/** AudioParam だけを持つノードのつまみ（名前がそのまま id）。値の範囲が極端なものは、既定値から決める */
function audioParams(node: AudioNode): [string, AudioParam][] {
  const out: [string, AudioParam][] = []
  // gain などは継承したゲッターなので、for-in で拾う
  for (const key in node) {
    const v = (node as unknown as Record<string, unknown>)[key]
    if (v instanceof AudioParam) out.push([key, v])
  }
  return out
}

/** つまみの一覧。WamNode はその API、ただのノードは AudioParam から */
export async function paramInfo(node: WamNodeLike): Promise<WamParamInfo[]> {
  if (node.getParameterInfo) return Object.values(await node.getParameterInfo())
  return audioParams(node).map(([id, p]) => ({
    id,
    type: 'float' as const,
    defaultValue: p.defaultValue,
    minValue: p.minValue > -1e6 ? p.minValue : p.defaultValue >= 0 ? 0 : -1,
    maxValue: p.maxValue < 1e6 ? p.maxValue : Math.max(1, p.defaultValue * 4),
  }))
}

/** つまみの値を渡す（id は WAM 側の id） */
export async function setParams(node: WamNodeLike, values: Record<string, number>): Promise<void> {
  if (node.setParameterValues) {
    await node.setParameterValues(Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { id, value, normalized: false }])))
    return
  }
  for (const [id, p] of audioParams(node)) if (id in values) p.value = values[id]
}

/** つまみの今の値を読む（WAM の画面で動かされた値を知るため） */
export async function getParams(node: WamNodeLike, ids: string[]): Promise<Record<string, number>> {
  if (node.getParameterValues) {
    const r = await node.getParameterValues(false, ...ids)
    return Object.fromEntries(Object.entries(r).map(([id, v]) => [id, v.value]))
  }
  return Object.fromEntries(audioParams(node).filter(([id]) => ids.includes(id)).map(([id, p]) => [id, p.value]))
}

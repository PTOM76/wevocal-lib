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
export interface WamNodeLike extends AudioNode {
  getParameterInfo(...ids: string[]): Promise<Record<string, WamParamInfo>>
  setParameterValues(updates: Record<string, { id: string; value: number; normalized: boolean }>): Promise<void>
  getState?(): Promise<unknown>
  setState?(state: unknown): Promise<void>
  destroy?(): void
}
export interface WamInstance {
  audioNode: WamNodeLike
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

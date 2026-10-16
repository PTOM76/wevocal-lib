// FX プラグインを作る人のための基底クラス。入口と出口、オンオフの素通し、値の丸め、片付けを引き受ける（使うかは任意）
import type { FxInstance, HostInfo, ParamDef, PluginManifest } from './types'

/** 値の更新をならす時間定数（秒） */
export const SMOOTH = 0.01

/** 範囲に丸める。選択肢があれば index に丸める */
export function clampParam(p: ParamDef, v: number): number {
  const x = Number.isFinite(v) ? v : p.default
  const r = p.choices ? Math.round(x) : x
  return Math.max(p.min, Math.min(p.max, r))
}

export abstract class FxBase implements FxInstance {
  readonly input: GainNode
  readonly output: GainNode
  /** build が組むノードの入口と出口（オフのときはここを通らず素通しになる） */
  protected readonly src: GainNode
  protected readonly dst: GainNode
  private readonly bypass: GainNode
  private readonly tracked: AudioNode[] = []
  private values: Record<string, number> = {}
  /** 作った直後の値は、ならさずにそのまま入れる（track したノードのつまみの setTargetAtTime を、この間だけ setValueAtTime にする） */
  private warm = false

  protected readonly ctx: BaseAudioContext
  protected readonly manifest: PluginManifest
  protected readonly host: HostInfo

  constructor(ctx: BaseAudioContext, manifest: PluginManifest, host: HostInfo) {
    this.ctx = ctx
    this.manifest = manifest
    this.host = host
    this.input = this.track(ctx.createGain())
    this.output = this.track(ctx.createGain())
    this.src = this.track(ctx.createGain())
    this.dst = this.track(ctx.createGain())
    this.bypass = this.track(ctx.createGain())
    this.input.connect(this.src)
    this.dst.connect(this.output)
    this.input.connect(this.bypass).connect(this.output)
  }

  /** 組み立てる（作った直後に 1 回。サブクラスのフィールドが決まってから呼ぶため、コンストラクターでは呼ばない） */
  init(values: Record<string, number>, on = true): this {
    this.build()
    this.warm = true
    this.update(values)
    this.warm = false
    this.setOn(on, true)
    return this
  }

  /** ノードを組んで、src と dst の間につなぐ */
  protected abstract build(): void
  /** 値をノードに当てはめる（now を使って setTargetAtTime でならす） */
  protected abstract apply(values: Record<string, number>, now: number): void

  update(values: Record<string, number>): void {
    const v: Record<string, number> = {}
    for (const p of this.manifest.params) v[p.id] = clampParam(p, values[p.id] ?? this.values[p.id] ?? p.default)
    this.values = v
    this.apply(v, this.ctx.currentTime)
  }

  setOn(on: boolean, immediate = false): void {
    const now = this.ctx.currentTime
    const set = (g: GainNode, x: number) => (immediate ? (g.gain.value = x) : g.gain.setTargetAtTime(x, now, SMOOTH))
    set(this.src, on ? 1 : 0)
    set(this.bypass, on ? 0 : 1)
  }

  dispose(): void {
    for (const n of this.tracked) n.disconnect()
  }

  /** 片付けの対象に登録する */
  protected track<T extends AudioNode>(node: T): T {
    this.tracked.push(node)
    for (const key in node) {
      const param = (node as unknown as Record<string, unknown>)[key]
      if (!(param instanceof AudioParam)) continue
      const target = param.setTargetAtTime.bind(param)
      param.setTargetAtTime = (v, t, tc) => (this.warm ? param.setValueAtTime(v, t) : target(v, t, tc))
    }
    return node
  }
}

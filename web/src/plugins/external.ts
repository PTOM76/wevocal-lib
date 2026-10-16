// 外から足したプラグイン（processor 方式）。AudioWorklet のモジュールを読み込み、つまみは AudioParam として渡す
import { FxBase, SMOOTH } from '../../../plugin-sdk/FxBase'
import { reportLoad, setOverloaded } from './registry'
import { processorName, type FxPlugin, type HostInfo, type PluginManifest } from '../../../plugin-sdk'

/** 導入したプラグインの中身（マニフェストと、processor のソース、wasm） */
export interface PluginPackage {
  manifest: PluginManifest
  processor: string
  wasm?: ArrayBuffer
  /** 取得元のマニフェストの URL（更新に使う） */
  source?: string
}

/**
 * processor の前に付ける測定の殻。registerProcessor を包み、process の時間を 128 サンプルの時間に対する割合として、約 1 秒ごとに port で知らせる
 * （AudioWorklet には細かい時計がないので、Date.now() の差を足し合わせて平均を取る）
 */
const MEASURE = `;(() => {
  const reg = registerProcessor
  globalThis.registerProcessor = (name, cls) => {
    const run = cls.prototype.process
    let total = 0
    let n = 0
    cls.prototype.process = function (i, o, p) {
      const t = Date.now()
      const r = run.call(this, i, o, p)
      total += Date.now() - t
      if (++n >= 344) {
        this.port.postMessage({ __wevocalLoad: total / (n * 128 / sampleRate * 1000) })
        total = 0
        n = 0
      }
      return r
    }
    reg(name, cls)
  }
})()
`
/** 続けてこの割合を超えた報告が OVERLOAD_COUNT 回続いたら、自動で素通しにする */
const OVERLOAD = 0.9
const OVERLOAD_COUNT = 3

/** AudioContext ごとに読み込んだモジュール（同じものを二度読まない） */
const loaded = new WeakMap<BaseAudioContext, Map<string, Promise<boolean>>>()
/** 読み込みが終わったもの（終わっていれば、ノードをその場で作れる。書き出しは作ったあとに足したノードを拾わないため） */
const ready = new WeakMap<BaseAudioContext, Set<string>>()
const moduleKey = (pkg: PluginPackage) => `${pkg.manifest.id}@${pkg.manifest.version}`

/** processor を ctx に読み込む。失敗したら false（素通しのまま動く） */
function loadModule(ctx: BaseAudioContext, pkg: PluginPackage): Promise<boolean> {
  let map = loaded.get(ctx)
  if (!map) loaded.set(ctx, (map = new Map()))
  const key = moduleKey(pkg)
  let p = map.get(key)
  if (!p) {
    const url = URL.createObjectURL(new Blob([MEASURE, pkg.processor], { type: 'text/javascript' }))
    p = ctx.audioWorklet
      .addModule(url)
      .then(() => {
        let set = ready.get(ctx)
        if (!set) ready.set(ctx, (set = new Set()))
        set.add(key)
        return true
      })
      .catch((e) => {
        console.warn(`plugin ${pkg.manifest.id}: failed to load`, e)
        return false
      })
      .finally(() => URL.revokeObjectURL(url))
    map.set(key, p)
  }
  return p
}

class WorkletFx extends FxBase {
  private node: AudioWorkletNode | null = null
  private disposed = false
  private latest: Record<string, number> = {}
  private wanted = true
  private overloaded = false
  private streak = 0

  private readonly pkg: PluginPackage

  constructor(ctx: BaseAudioContext, pkg: PluginPackage, host: HostInfo) {
    super(ctx, pkg.manifest, host)
    this.pkg = pkg
  }

  protected build() {
    // 読み込み済みならその場でつなぐ。まだなら、読み込みが終わるまで素通しにしておく
    if (ready.get(this.ctx)?.has(moduleKey(this.pkg))) this.attach()
    else {
      this.waiting = true
      super.setOn(false)
      void loadModule(this.ctx, this.pkg).then((ok) => {
        this.waiting = false
        if (ok && !this.disposed) this.attach()
        super.setOn(this.wanted && !this.overloaded)
      })
    }
  }

  private waiting = false

  private attach() {
    const node = new AudioWorkletNode(this.ctx, processorName(this.pkg.manifest.id), {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasm: this.pkg.wasm, sampleRate: this.ctx.sampleRate },
    })
    this.node = node
    // 再生中の AudioContext だけ負荷を見る（書き出しは速く進むので、時間の割合に意味がない）
    if (this.ctx instanceof AudioContext) node.port.onmessage = (e) => this.onLoad(e.data?.__wevocalLoad)
    this.src.connect(node).connect(this.dst)
    this.apply(this.latest, this.ctx.currentTime)
  }

  private onLoad(ratio: unknown) {
    if (typeof ratio !== 'number') return
    reportLoad(this.pkg.manifest.id, ratio)
    this.streak = ratio > OVERLOAD ? this.streak + 1 : 0
    if (this.streak >= OVERLOAD_COUNT && !this.overloaded) {
      // 音が途切れ続けるのを避けるため、自動で素通しにする。オフにしてからオンにし直すと、また試す
      this.overloaded = true
      setOverloaded(this.pkg.manifest.id, true)
      super.setOn(false)
    }
  }

  setOn(on: boolean, immediate = false) {
    if (on && !this.wanted) {
      this.overloaded = false
      this.streak = 0
      setOverloaded(this.pkg.manifest.id, false)
    }
    this.wanted = on
    super.setOn(on && !this.overloaded && !this.waiting, immediate)
  }

  protected apply(v: Record<string, number>, now: number) {
    this.latest = v
    if (!this.node) return
    for (const [id, x] of Object.entries(v)) this.node.parameters.get(id)?.setTargetAtTime(x, now, SMOOTH)
  }

  dispose() {
    this.disposed = true
    this.node?.disconnect()
    super.dispose()
  }
}

/** パッケージから FX プラグインを作る */
export function makeExternalPlugin(pkg: PluginPackage): FxPlugin {
  return {
    manifest: pkg.manifest,
    lang: pkg.manifest.lang ?? {},
    preload: async (ctx) => void (await loadModule(ctx, pkg)),
    create: (ctx, values, host, on = true) => new WorkletFx(ctx, pkg, host).init(values, on),
  }
}

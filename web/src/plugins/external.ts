// 外から足したプラグイン（processor 方式）。AudioWorklet のモジュールを読み込み、つまみは AudioParam として渡す
import { FxBase, SMOOTH } from '../../../plugin-sdk/FxBase'
import { processorName, type FxPlugin, type HostInfo, type PluginManifest } from '../../../plugin-sdk'

/** 導入したプラグインの中身（マニフェストと、processor のソース、wasm） */
export interface PluginPackage {
  manifest: PluginManifest
  processor: string
  wasm?: ArrayBuffer
}

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
    const url = URL.createObjectURL(new Blob([pkg.processor], { type: 'text/javascript' }))
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

  private readonly pkg: PluginPackage

  constructor(ctx: BaseAudioContext, pkg: PluginPackage, host: HostInfo) {
    super(ctx, pkg.manifest, host)
    this.pkg = pkg
  }

  protected build() {
    // 読み込み済みならその場でつなぐ。まだなら読み込みが終わってからつなぐ（それまでは素通しにならず無音なので、先に preload する）
    if (ready.get(this.ctx)?.has(moduleKey(this.pkg))) this.attach()
    else void loadModule(this.ctx, this.pkg).then((ok) => ok && !this.disposed && this.attach())
  }

  private attach() {
    const node = new AudioWorkletNode(this.ctx, processorName(this.pkg.manifest.id), {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasm: this.pkg.wasm, sampleRate: this.ctx.sampleRate },
    })
    this.node = node
    this.src.connect(node).connect(this.dst)
    this.apply(this.latest, this.ctx.currentTime)
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

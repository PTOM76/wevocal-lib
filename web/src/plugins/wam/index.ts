// WebAudio Modules 2.0 を、WeVocal の FX プラグインとして包む。
// 導入するとき 1 回だけ WAM を読み込んで名前とパラメーターの一覧を調べ、マニフェストを作って固定する（毎回の読み込みでは作らない）
import { FxBase } from '../../../../plugin-sdk/FxBase'
import { PluginError } from '../validate'
import { createWam, getParams, paramInfo, setParams, type WamInstance, type WamNodeLike } from './host'
import type { PluginPackage } from '../external'
import type { FxPlugin, GuiHandle, GuiState, HostInfo, ParamDef, PluginManifest } from '../../../../plugin-sdk'

const WAM_SAMPLE_RATE = 48000
const MAX_COMPENSATION_SECONDS = 1

/** id に使える形にする */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'wam'

/** WAM API は秒を返すが、実装によってはサンプル数を返す。遅延補正ノードの上限を超えない値にする */
function compensationSamples(delay: number, sampleRate: number) {
  if (!Number.isFinite(delay) || delay <= 0) return 0
  const samples = Number.isInteger(delay) && delay > 1 ? delay : delay * sampleRate
  return Math.round(Math.min(samples, sampleRate * MAX_COMPENSATION_SECONDS))
}

/** 以前、サンプル数を秒として扱って保存した WAM の遅延値を読み込み時に直す */
function normalizeWamManifest(manifest: PluginManifest): PluginManifest {
  const latency = manifest.latency ?? 0
  if (latency <= WAM_SAMPLE_RATE) return manifest
  return { ...manifest, latency: Math.min(WAM_SAMPLE_RATE, Math.round(latency / WAM_SAMPLE_RATE)) }
}

/** URL（モジュールの JS）から、導入するパッケージを作る。読み込めない、FX でない WAM は PluginError */
export async function wamPackageFromUrl(url: string): Promise<PluginPackage> {
  const abs = new URL(url, location.href).href
  // 調べるだけなので、音を出さない小さな OfflineAudioContext を使う
  const ctx = new OfflineAudioContext(2, 128, 48000)
  let inst: WamInstance
  try {
    inst = await createWam(ctx, abs)
  } catch (e) {
    throw new PluginError('wam', e instanceof Error ? e.message : String(e))
  }
  try {
    const d = inst.descriptor
    if (d.isInstrument || d.hasAudioInput === false) throw new PluginError('kind')
    const name = d.name || abs.split('/').slice(-2, -1)[0] || 'WAM'
    const info = await paramInfo(inst.audioNode)
    // SDK は秒を返すが、互換性のためサンプル数を返す実装も受け入れる
    const delay = (await inst.audioNode.getCompensationDelay?.().catch(() => 0)) ?? 0
    const lang: Record<string, Record<string, string>> = { ja_jp: { name }, en_us: { name } }
    const params: ParamDef[] = []
    const ids: string[] = []
    for (const p of info) {
      const pid = `p${params.length}`
      const choices = p.type === 'choice' && p.choices?.length ? p.choices : undefined
      const def: ParamDef = {
        id: pid,
        name: `param.${pid}`,
        min: choices ? 0 : p.minValue,
        max: choices ? choices.length - 1 : p.maxValue,
        default: choices ? Math.max(0, Math.min(choices.length - 1, Math.round(p.defaultValue))) : p.defaultValue,
        ...(p.type === 'int' || p.type === 'boolean' ? { step: 1 } : p.discreteStep ? { step: p.discreteStep } : {}),
        ...(choices ? { choices: choices.map((_, i) => `choice.${pid}.${i}`) } : {}),
      }
      params.push(def)
      ids.push(p.id)
      lang.ja_jp[def.name] = lang.en_us[def.name] = p.label || p.id
      choices?.forEach((c, i) => (lang.ja_jp[`choice.${pid}.${i}`] = lang.en_us[`choice.${pid}.${i}`] = String(c)))
    }
    const manifest: PluginManifest = {
      id: `wam.${slug(d.identifier || name)}-${slug(new URL(abs).host)}`.slice(0, 64),
      api: 1,
      kind: 'fx',
      format: 'wam',
      version: d.version || '1.0.0',
      author: d.vendor || 'WAM',
      name: 'name',
      // WAM のコードはこのページのスレッドでも動く（読み込みと画面の部分）ので、隔離されないことを権限として見せる
      permissions: ['main-thread'],
      ...(delay > 0 ? { latency: compensationSamples(delay, ctx.sampleRate) } : {}),
      params,
      lang,
    }
    return { manifest, processor: '', wam: { url: abs, ids }, source: abs }
  } finally {
    inst.audioNode.destroy?.()
  }
}

/** preload で作ったインスタンスを create へ渡す（書き出しは同期でグラフを組むので、先に作っておく） */
const pool = new WeakMap<BaseAudioContext, Map<string, WamInstance[]>>()

class WamFx extends FxBase {
  private node: WamNodeLike | null = null
  private disposed = false
  private wanted = true
  private waiting = false
  private latest: Record<string, number> = {}
  private sent: Record<string, number> = {}
  private state?: string
  private readonly pkg: PluginPackage

  constructor(ctx: BaseAudioContext, pkg: PluginPackage, host: HostInfo, state?: string) {
    super(ctx, pkg.manifest, host)
    this.pkg = pkg
    this.state = state
  }

  protected build() {
    const ready = pool.get(this.ctx)?.get(this.pkg.manifest.id)?.pop()
    if (ready) return this.attach(ready)
    // まだ作れていなければ、できるまで素通し
    this.waiting = true
    super.setOn(false)
    createWam(this.ctx, this.pkg.wam!.url).then(
      (inst) => {
        this.waiting = false
        if (this.disposed) inst.audioNode.destroy?.()
        else this.attach(inst)
        super.setOn(this.wanted)
      },
      (e) => console.warn(`plugin ${this.pkg.manifest.id}: failed to load`, e),
    )
  }

  private attach(inst: WamInstance) {
    this.node = inst.audioNode
    if (this.state) this.setState(this.state)
    this.src.connect(this.node).connect(this.dst)
    this.send(this.latest)
  }

  setState(state: string | undefined) {
    this.state = state
    if (!state || !this.node?.setState) return
    try {
      void this.node.setState(JSON.parse(state))
    } catch {
      // 読めない状態は捨てる
    }
  }

  setOn(on: boolean, immediate = false) {
    this.wanted = on
    super.setOn(on && !this.waiting, immediate)
  }

  protected apply(v: Record<string, number>) {
    this.latest = v
    this.send(v)
  }

  /** 変わったつまみだけ WAM に渡す */
  private send(v: Record<string, number>) {
    if (!this.node) return
    const updates: Record<string, number> = {}
    this.pkg.manifest.params.forEach((p, i) => {
      const x = v[p.id]
      const id = this.pkg.wam!.ids[i]
      if (x === undefined || id === undefined || this.sent[p.id] === x) return
      this.sent[p.id] = x
      updates[id] = x
    })
    if (Object.keys(updates).length) void setParams(this.node, updates)
  }

  dispose() {
    this.disposed = true
    this.node?.disconnect()
    this.node?.destroy?.()
    super.dispose()
  }
}

/** パッケージから FX プラグインを作る */
export function makeWamPlugin(pkg: PluginPackage): FxPlugin {
  const normalized = { ...pkg, manifest: normalizeWamManifest(pkg.manifest) }
  return {
    manifest: normalized.manifest,
    lang: normalized.manifest.lang ?? {},
    preload: async (ctx) => {
      let map = pool.get(ctx)
      if (!map) pool.set(ctx, (map = new Map()))
      const list = map.get(normalized.manifest.id) ?? []
      // 1 つだけ先に作る（同じ WAM を複数の列に入れたぶんは、できるまで素通し）
      if (!list.length) {
        const inst = await createWam(ctx, normalized.wam!.url).catch(() => null)
        if (inst) list.push(inst)
      }
      map.set(normalized.manifest.id, list)
    },
    create: (ctx, values, host, on = true, state) => new WamFx(ctx, normalized, host, state).init(values, on),
    mountGui: (el, values, onChange, state) => mountWamGui(normalized, el, values, onChange, state),
  }
}

/**
 * WAM 自身の画面を el に出す。鳴らしているノードとは別に、音を出さないインスタンスを 1 つ作って画面に付け、
 * 画面で動かしたつまみを 100 ms ごとに読んで onChange で返す（ホストの値が正で、変わったぶんだけ画面へ渡す）。
 * 画面を持たない WAM は null（呼び出す側が自動の画面にする）
 */
async function mountWamGui(pkg: PluginPackage, el: HTMLElement, values: Record<string, number>, onChange: (id: string, value: number) => void, io?: GuiState): Promise<GuiHandle | null> {
  const { ids } = pkg.wam!
  const params = pkg.manifest.params
  const inst = await createWam(new OfflineAudioContext(2, 128, 48000), pkg.wam!.url).catch(() => null)
  const gui = await inst?.createGui?.().catch(() => null)
  if (!inst || !gui) {
    inst?.audioNode.destroy?.()
    return null
  }
  el.appendChild(gui)
  const toWam = (v: Record<string, number>) => Object.fromEntries(params.flatMap((p, i) => (v[p.id] === undefined ? [] : [[ids[i], v[p.id]]])))
  const known: Record<string, number> = { ...values }
  // ホストから画面へ渡した値は、画面のインスタンスに届くまで読み戻さない（古い値を読んで書き戻すのを防ぐ）。id → 渡した時刻
  const sentAt: Record<string, number> = {}
  await setParams(inst.audioNode, toWam(known))
  // 状態（WAM に変更の通知はないので、画面を出している間だけ 500 ms ごとに読んで、変わったら知らせる）
  const node = inst.audioNode
  let lastState = io?.initial
  if (io?.initial && node.setState) await node.setState(JSON.parse(io.initial)).catch(() => {})
  // 保存してある状態がなければ、開いた時点の状態を基準にする（開いただけで保存が走らないように）
  if (lastState === undefined && node.getState) lastState = JSON.stringify(await node.getState().catch(() => undefined))
  let stateBusy = false
  const stateTimer = io && node.getState
    ? setInterval(async () => {
        if (stateBusy) return
        stateBusy = true
        try {
          const st = JSON.stringify(await node.getState!())
          if (st !== lastState) io?.onState((lastState = st))
        } catch {
          // 読めない状態は無視する
        } finally {
          stateBusy = false
        }
      }, 500)
    : 0
  let busy = false
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      const now = await getParams(inst.audioNode, ids)
      params.forEach((p, i) => {
        const x = now[ids[i]]
        if (p.id in sentAt) {
          if (x !== undefined && Math.abs(x - known[p.id]) <= 1e-9) delete sentAt[p.id]
          else if (Date.now() - sentAt[p.id] < 1000) return
          else delete sentAt[p.id]
        }
        if (x !== undefined && Math.abs(x - known[p.id]) > 1e-9) {
          known[p.id] = x
          onChange(p.id, x)
        }
      })
    } finally {
      busy = false
    }
  }, 100)
  return {
    update(v) {
      const diff: Record<string, number> = {}
      for (const p of params) if (v[p.id] !== undefined && v[p.id] !== known[p.id]) {
        diff[p.id] = known[p.id] = v[p.id]
        sentAt[p.id] = Date.now()
      }
      if (Object.keys(diff).length) void setParams(inst.audioNode, toWam(diff))
    },
    dispose() {
      clearInterval(timer)
      clearInterval(stateTimer)
      inst.destroyGui?.(gui)
      gui.remove()
      inst.audioNode.destroy?.()
    },
  }
}

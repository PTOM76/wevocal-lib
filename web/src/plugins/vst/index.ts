// VST の DLL を、WeVocal の FX プラグインのパッケージにする（試験的機能。実行環境は wevocal-vstbridge の wasm エミュレーター）。
// DLL を一度読み込んでつまみの数と名前を調べ、manifest と processor を作る。processor は AudioWorklet の中でエミュレーターを動かす。
// 再生でも掛ける（realtime は既定の true）。エミュレーターは軽いプラグインで 1 台あたり処理時間の約半分なので間に合うが、重いプラグインは自動で素通しになる（負荷の監視）。Studio の「先に計算する」でも使える（anticipative は既定の true のまま）
import { PluginError } from '../validate'
import type { PluginPackage } from '../external'
import type { PluginManifest } from '../../../../plugin-sdk'
import { JsVst } from './vstbridge.js'
import { loadBridge } from './bridge'
import { WORKLET_GLUE } from './workletGlue'

/** id に使える形にする */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'vst'

async function sha(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * processor のソース（つまみは k-rate の AudioParam。変わったときだけ VST に渡す）。wasm と DLL は processorOptions で受け取る。
 * 読み込み（DllMain、VSTPluginMain など）は重い（大きい DLL で数秒）ので、JsVstLoader で 1 回の process ごとに約 1 ms ずつ進め、終わるまでは素通しにする
 * （音を出すスレッドを長く止めない）。外した processor の VST は置き場に戻し、同じ AudioContext で次に作る processor が使い回す
 */
function makeProcessor(id: string, ids: string[], defaults: number[]): string {
  const descriptors = JSON.stringify(ids.map((name, i) => ({ name, defaultValue: defaults[i], minValue: 0, maxValue: 1, automationRate: 'k-rate' })))
  const name = 'wevocal-fx-' + id.replace(/[^a-zA-Z0-9]/g, '-')
  return `${WORKLET_GLUE}
class VstProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return ${descriptors} }
  constructor(options) {
    super()
    const o = options.processorOptions || {}
    this.ids = ${JSON.stringify(ids)}
    this.last = new Array(this.ids.length).fill(NaN)
    this.vst = null
    this.loader = null
    // 読み込みを 1 回に進める命令の数（1 回が約 1 ms になるよう、かかった時間で増減する）
    this.budget = 20000
    this.failed = false
    // 置き場は AudioContext の中で共有なので、プラグインごとに分ける
    const pools = (globalThis.__wevocalVstPool ||= {})
    const pool = (pools[${JSON.stringify(id)}] ||= [])
    try {
      initSync({ module: o.wasm })
      this.vst = pool.pop() || null
      if (!this.vst) this.loader = new JsVstLoader(new Uint8Array(o.dll))
    } catch (e) {
      this.failed = true
      this.port.postMessage({ __wevocalError: String(e) })
    }
    // 外されたら、止まっていない VST を置き場に戻す（つまみは次の process で全部渡し直す）
    this.port.addEventListener('message', (e) => {
      if (!e.data || !e.data.__wevocalDispose) return
      if (this.loader) {
        this.loader.free()
        this.loader = null
      }
      if (!this.vst) return
      if (!this.failed) pool.push(this.vst)
      this.vst = null
    })
    this.port.start()
  }
  process(inputs, outputs, parameters) {
    const out = outputs[0]
    const inp = inputs[0]
    if (this.loader && !this.failed) this.stepLoad()
    if (this.failed || !this.vst) {
      for (let c = 0; c < out.length; c++) if (inp[c]) out[c].set(inp[c])
      return true
    }
    for (let i = 0; i < this.ids.length; i++) {
      const v = parameters[this.ids[i]][0]
      if (v !== this.last[i]) { this.vst.setParam(i, v); this.last[i] = v }
    }
    const n = out[0].length
    const chans = []
    for (let c = 0; c < this.vst.numInputs; c++) chans.push(inp[c] ?? inp[0] ?? new Float32Array(n))
    // エミュレーターが止まったら（対応していない命令など）、例外で processor ごと無音にならないよう、以後は素通しにする
    let res
    try {
      res = this.vst.process(chans, n)
    } catch (e) {
      this.failed = true
      this.port.postMessage({ __wevocalError: String(e) })
      for (let c = 0; c < out.length; c++) if (inp[c]) out[c].set(inp[c])
      return true
    }
    // 出力に NaN や inf が混ざったら、そのブロックは 0 にして、以後は素通しにする（暴走したプラグインが音を壊し続けないように）
    let bad = false
    for (let c = 0; c < out.length && !bad; c++) {
      const r = res[c] ?? res[0]
      for (let i = 0; i < r.length; i++) if (!Number.isFinite(r[i])) { bad = true; break }
    }
    if (bad) {
      this.failed = true
      this.port.postMessage({ __wevocalError: 'non-finite output' })
      for (let c = 0; c < out.length; c++) out[c].fill(0)
      return true
    }
    for (let c = 0; c < out.length; c++) out[c].set(res[c] ?? res[0])
    return true
  }
  /** 読み込みを少し進める。終わったら JsVst にする */
  stepLoad() {
    try {
      const t0 = currentTimeMs()
      const done = this.loader.step(this.budget)
      const ms = currentTimeMs() - t0
      if (ms < 0.5) this.budget = Math.min(this.budget * 2, 2000000)
      else if (ms > 2) this.budget = Math.max(this.budget / 2, 1000)
      if (done) {
        this.vst = this.loader.finish()
        this.loader = null
      }
    } catch (e) {
      this.failed = true
      this.loader = null
      this.port.postMessage({ __wevocalError: String(e) })
    }
  }
}
// AudioWorklet には performance が無いことがあるので、無ければ Date で測る
function currentTimeMs() {
  return globalThis.performance ? globalThis.performance.now() : Date.now()
}
registerProcessor('${name}', VstProcessor)
`
}

/** 導入済みの VST の processor と wasm を今のものにする（導入したときの古いエミュレーターのままにしない） */
export async function refreshVstPackage(pkg: PluginPackage): Promise<PluginPackage> {
  const params = pkg.manifest.params
  return { ...pkg, wasm: await loadBridge(), processor: makeProcessor(pkg.manifest.id, params.map((p) => p.id), params.map((p) => p.default)) }
}

/** 重さを量る。雑音を 128 サンプルずつ通し、処理にかかった時間 ÷ 音の長さを返す（48 kHz とみなす。始めの数回は除く） */
function measureLoad(vst: JsVst): number {
  const n = 128
  const chans = Array.from({ length: Math.max(1, vst.numInputs) }, () => Float32Array.from({ length: n }, () => Math.random() * 0.2 - 0.1))
  for (let i = 0; i < 8; i++) vst.process(chans, n)
  const blocks = 96
  const t0 = performance.now()
  for (let i = 0; i < blocks; i++) vst.process(chans, n)
  return (performance.now() - t0) / 1000 / ((blocks * n) / 48000)
}

/**
 * DLL からパッケージを作る。DLL でなかった、読み込めなかったときは PluginError('manifest')。
 * 導入するとき 1 回だけ呼ぶ（つまみの数と名前は DLL ごとに違うので、ここで調べて manifest に固定する）
 */
export async function vstPackage(dll: ArrayBuffer, fileName: string): Promise<PluginPackage> {
  const wasm = await loadBridge()
  let vst: JsVst
  try {
    vst = new JsVst(new Uint8Array(dll))
  } catch (e) {
    // DLL でない、エミュレーターが対応していない命令や API を使っている、など。理由をそのまま添える
    console.error('Failed to initialize VST plugin', { fileName, error: e })
    throw new PluginError('vst', e instanceof Error ? e.message : String(e))
  }
  try {
    const name = vst.name() || fileName.replace(/\.dll$/i, '')
    const id = `vst.${slug(name)}-${await sha(dll)}`
    const params: PluginManifest['params'] = []
    const lang: Record<string, Record<string, string>> = { ja_jp: { name }, en_us: { name } }
    for (let i = 0; i < vst.numParams; i++) {
      const pid = `p${i}`
      params.push({ id: pid, name: `param.${pid}`, min: 0, max: 1, default: vst.getParam(i), step: 0.001 })
      const pn = vst.paramName(i)
      lang.ja_jp[`param.${pid}`] = pn
      lang.en_us[`param.${pid}`] = pn
    }
    const manifest: PluginManifest = {
      id,
      api: 1,
      kind: 'fx',
      format: 'vst',
      version: '1.0.0',
      author: 'VST',
      name: 'name',
      // リバーブなどの余韻を書き出しで切らないための長さ（秒）。DLL からは分からないので固定
      tail: 4,
      permissions: [],
      params,
      processor: 'processor.js',
      lang,
    }
    // 量れなかったとき（処理で落ちる）は目安を出さない
    let load: number | undefined
    try {
      load = measureLoad(vst)
    } catch (error) {
      console.warn('Failed to measure VST plugin load; continuing without an estimate', { id, name, error })
      load = undefined
    }
    return { manifest, processor: makeProcessor(id, params.map((p) => p.id), params.map((p) => p.default)), wasm, dll, load }
  } finally {
    vst.free()
  }
}

/** ファイル（File）から */
export async function vstPackageFromFile(file: File): Promise<PluginPackage> {
  return vstPackage(await file.arrayBuffer(), file.name)
}

/** URL（DLL そのもの）から */
export async function vstPackageFromUrl(url: string): Promise<PluginPackage> {
  const res = await fetch(new URL(url, location.href)).catch(() => null)
  if (!res?.ok) throw new PluginError('fetch')
  return vstPackage(await res.arrayBuffer(), decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? 'vst.dll'))
}

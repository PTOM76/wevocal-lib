// VST の DLL を、WeVocal の FX プラグインのパッケージにする（試験的機能。実行環境は wevocal-vstbridge の wasm エミュレーター）。
// DLL を一度読み込んでつまみの数と名前を調べ、manifest と processor を作る。processor は AudioWorklet の中でエミュレーターを動かす。
// 書き出し専用（realtime: false）: エミュレーターは再生に間に合わないので、再生中は素通しにする。書き出しで掛け、再生中は先に計算して鳴らす（Studio の設定の「先に計算する」。anticipative は既定の true のまま）
import { PluginError } from '../validate'
import type { PluginPackage } from '../external'
import type { PluginManifest } from '../../../../plugin-sdk'
import init, { JsVst } from './vstbridge.js'
import wasmUrl from './vstbridge_bg.wasm?url'
import { WORKLET_GLUE } from './workletGlue'

let ready: Promise<ArrayBuffer> | null = null

/** wasm を読み込む（初回だけ）。processor にも同じバイト列を渡す */
function load(): Promise<ArrayBuffer> {
  ready ??= fetch(wasmUrl)
    .then((r) => r.arrayBuffer())
    .then(async (bytes) => {
      await init({ module_or_path: bytes })
      return bytes
    })
  return ready
}

/** id に使える形にする */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'vst'

async function sha(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** processor のソース（つまみは k-rate の AudioParam。変わったときだけ VST に渡す）。wasm と DLL は processorOptions で受け取る */
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
    this.failed = false
    try {
      initSync({ module: o.wasm })
      this.vst = new JsVst(new Uint8Array(o.dll))
    } catch (e) {
      this.failed = true
      this.port.postMessage({ __wevocalError: String(e) })
    }
  }
  process(inputs, outputs, parameters) {
    const out = outputs[0]
    const inp = inputs[0]
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
    const res = this.vst.process(chans, n)
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
}
registerProcessor('${name}', VstProcessor)
`
}

/**
 * DLL からパッケージを作る。DLL でなかった、読み込めなかったときは PluginError('manifest')。
 * 導入するとき 1 回だけ呼ぶ（つまみの数と名前は DLL ごとに違うので、ここで調べて manifest に固定する）
 */
export async function vstPackage(dll: ArrayBuffer, fileName: string): Promise<PluginPackage> {
  const wasm = await load()
  let vst: JsVst
  try {
    vst = new JsVst(new Uint8Array(dll))
  } catch (e) {
    // DLL でない、エミュレーターが対応していない命令や API を使っている、など。理由をそのまま添える
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
      realtime: false,
      permissions: [],
      params,
      processor: 'processor.js',
      lang,
    }
    return { manifest, processor: makeProcessor(id, params.map((p) => p.id), params.map((p) => p.default)), wasm, dll }
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

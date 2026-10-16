// WeVocal プラグインのビルドの道具。使い方:
//   node wevocal-plugin.mjs create <フォルダー> <id>   雛形（template-processor）を写して、id を書き換える
//   node wevocal-plugin.mjs build <フォルダー>         manifest.json と lang/ をまとめて dist/ に出す（配るのは dist/ の中身）
//   node wevocal-plugin.mjs check <フォルダー>         マニフェストと processor の食い違いを調べる
//   node wevocal-plugin.mjs test <フォルダー> [--update]  決まった音（正弦波、雑音、インパルス）を通して、前回の結果と比べる。余韻、遅れ、処理時間も測る
import { runInNewContext } from 'node:vm'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [cmd, dirArg, idArg] = process.argv.slice(2)

const fail = (msg) => {
  console.error(`エラー: ${msg}`)
  process.exit(1)
}
const readJson = (p) => JSON.parse(readFileSync(p, 'utf-8'))
/** processor が registerProcessor する名前（plugin-sdk/types.ts の processorName と同じ） */
const processorName = (id) => `wevocal-fx-${id.replace(/[^a-zA-Z0-9]/g, '-')}`

if (!cmd || !dirArg || !['create', 'build', 'check', 'test'].includes(cmd)) fail('使い方: wevocal-plugin.mjs create|build|check|test <フォルダー> [id]')
const dir = resolve(dirArg)

if (cmd === 'create') {
  if (!idArg || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(idArg) || idArg.startsWith('wevocal.')) fail('id は小文字の英数字と . _ - で、wevocal. から始めない')
  if (existsSync(dir) && readdirSync(dir).length) fail('フォルダーが空ではありません')
  cpSync(join(here, '..', 'template-processor'), dir, { recursive: true })
  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, readFileSync(manifestPath, 'utf-8').replace('example.gain', idArg))
  const procPath = join(dir, 'src', 'processor.js')
  writeFileSync(procPath, readFileSync(procPath, 'utf-8').replace('wevocal-fx-example-gain', processorName(idArg)))
  console.log(`作りました: ${dir}`)
  process.exit(0)
}

/** 食い違いを調べる。問題の一覧を返す */
function check() {
  const problems = []
  const manifest = readJson(join(dir, 'manifest.json'))
  if (manifest.api !== 1) problems.push('api は 1 にしてください')
  if (manifest.kind !== 'fx') problems.push('kind は fx にしてください')
  if (manifest.format !== 'wevocal') problems.push('format は wevocal にしてください')
  if (typeof manifest.id !== 'string' || manifest.id.startsWith('wevocal.')) problems.push('id が正しくありません（wevocal. は標準のプラグイン用）')
  const procFile = join(dir, 'src', manifest.processor ?? 'processor.js')
  if (!existsSync(procFile)) {
    problems.push(`processor が見つかりません: ${procFile}`)
    return problems
  }
  const code = readFileSync(procFile, 'utf-8')
  if (!code.includes(`'${processorName(manifest.id)}'`) && !code.includes(`"${processorName(manifest.id)}"`)) problems.push(`registerProcessor の名前が ${processorName(manifest.id)} ではありません`)
  for (const p of manifest.params ?? []) if (!code.includes(`'${p.id}'`) && !code.includes(`"${p.id}"`)) problems.push(`つまみ ${p.id} が processor の parameterDescriptors に見つかりません`)
  const langDir = join(dir, 'lang')
  const langs = existsSync(langDir) ? readdirSync(langDir).filter((f) => f.endsWith('.json')) : []
  if (!langs.includes('en_us.json')) problems.push('lang/en_us.json がありません（ほかの言語の訳がないときに使う）')
  const keys = ['name', ...(manifest.params ?? []).flatMap((p) => [p.name ?? `param.${p.id}`, ...(p.choices ?? [])])]
  for (const f of langs) {
    const lang = readJson(join(langDir, f))
    for (const k of keys) if (!(k in lang)) problems.push(`${f} にキー ${k} がありません`)
  }
  return problems
}

/** processor を Node の中で動かして、決まった音を通す（AudioWorklet の入れ物をまねる） */
function runTest() {
  const SR = 48000
  const manifest = readJson(join(dir, 'manifest.json'))
  const code = readFileSync(join(dir, 'src', manifest.processor ?? 'processor.js'), 'utf-8')
  const registered = {}
  const scope = {
    sampleRate: SR,
    currentTime: 0,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage() {}, onmessage: null }
      }
    },
    registerProcessor: (name, cls) => (registered[name] = cls),
    console,
    Math,
    Float32Array,
    Int32Array,
    Uint8Array,
    ArrayBuffer,
    WebAssembly,
    Date,
  }
  runInNewContext(code.replace(/^export\s+/gm, ''), scope)
  const Cls = registered[processorName(manifest.id)]
  if (!Cls) fail(`registerProcessor('${processorName(manifest.id)}') が呼ばれていません`)
  const wasm = manifest.wasm && existsSync(join(dir, manifest.wasm)) ? readFileSync(join(dir, manifest.wasm)).buffer : undefined
  const defaults = Object.fromEntries((manifest.params ?? []).map((p) => [p.id, p.default]))

  /** mono の入力を通して、左右の出力（左）を返す。処理時間（128 サンプルあたりの ms）も返す */
  const run = (input, seconds) => {
    const proc = new Cls({ processorOptions: { wasm, sampleRate: SR } })
    const n = Math.ceil((seconds * SR) / 128) * 128
    const out = new Float32Array(n)
    const params = Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, new Float32Array([v])]))
    let ns = 0n
    for (let i = 0; i < n; i += 128) {
      const inp = new Float32Array(128)
      for (let j = 0; j < 128; j++) inp[j] = input(i + j)
      const o = [new Float32Array(128), new Float32Array(128)]
      const t = process.hrtime.bigint()
      proc.process([[inp, inp]], [o], params)
      ns += process.hrtime.bigint() - t
      out.set(o[0], i)
      scope.currentTime = (i + 128) / SR
    }
    return { out, msPerQuantum: Number(ns) / 1e6 / (n / 128) }
  }
  let seed = 1
  const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
  const stats = (a) => {
    let peak = 0
    let sum = 0
    let bad = false
    for (const v of a) {
      if (!Number.isFinite(v)) bad = true
      peak = Math.max(peak, Math.abs(v))
      sum += v * v
    }
    return { peak: +peak.toFixed(5), rms: +Math.sqrt(sum / a.length).toFixed(5), bad }
  }
  const sine = run((i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR), 1)
  const nz = run(() => 0.3 * noise(), 1)
  const imp = run((i) => (i === 0 ? 1 : 0), 10)
  // 遅れ: インパルスの出力が最大になる位置。余韻: 最大から 60 dB 下がったあと、最後に超えた位置
  let peakAt = 0
  let peak = 0
  imp.out.forEach((v, i) => Math.abs(v) > peak && ((peak = Math.abs(v)), (peakAt = i)))
  let lastLoud = peakAt
  for (let i = imp.out.length - 1; i > peakAt; i--) if (Math.abs(imp.out[i]) > peak * 0.001) { lastLoud = i; break }
  const result = {
    sine: stats(sine.out),
    noise: stats(nz.out),
    impulse: stats(imp.out),
    latencySamples: peakAt,
    tailSeconds: +((lastLoud - peakAt) / SR).toFixed(3),
  }
  const ms = Math.max(sine.msPerQuantum, nz.msPerQuantum)
  const quantumMs = (128 / SR) * 1000
  console.log(`遅れ ${result.latencySamples} サンプル、余韻 ${result.tailSeconds} 秒、処理時間 ${ms.toFixed(4)} ms（128 サンプルは ${quantumMs.toFixed(2)} ms。負荷 ${((ms / quantumMs) * 100).toFixed(1)}%）`)
  const bad = [result.sine, result.noise, result.impulse].some((s) => s.bad)
  if (bad) fail('出力に NaN か無限大があります')
  if (manifest.tail !== undefined && result.tailSeconds > manifest.tail + 0.05) console.warn(`警告: 余韻 ${result.tailSeconds} 秒がマニフェストの tail ${manifest.tail} 秒より長い`)
  if ((manifest.latency ?? 0) !== result.latencySamples && result.latencySamples > 0) console.warn(`警告: 遅れ ${result.latencySamples} サンプルがマニフェストの latency ${manifest.latency ?? 0} と違う`)
  const baseline = join(dir, 'test', 'baseline.json')
  if (process.argv.includes('--update') || !existsSync(baseline)) {
    mkdirSync(join(dir, 'test'), { recursive: true })
    writeFileSync(baseline, JSON.stringify(result, null, 2))
    console.log(`前回の結果を書きました: ${baseline}`)
    return
  }
  const before = readJson(baseline)
  const diffs = []
  for (const sig of ['sine', 'noise', 'impulse']) for (const k of ['peak', 'rms']) if (Math.abs(before[sig][k] - result[sig][k]) > 1e-4) diffs.push(`${sig}.${k}: ${before[sig][k]} → ${result[sig][k]}`)
  for (const k of ['latencySamples', 'tailSeconds']) if (before[k] !== result[k]) diffs.push(`${k}: ${before[k]} → ${result[k]}`)
  if (diffs.length) {
    for (const d of diffs) console.error(`- ${d}`)
    fail('前回の結果と違います（意図した変更なら --update で書き直す）')
  }
  console.log('前回の結果と同じです')
}

const problems = check()
for (const p of problems) console.error(`- ${p}`)
if (cmd === 'check') process.exit(problems.length ? 1 : 0)
if (cmd === 'test') {
  if (problems.length) fail('上の問題を直してからテストしてください')
  runTest()
  process.exit(0)
}
if (problems.length) fail('上の問題を直してからビルドしてください')

// build
const manifest = readJson(join(dir, 'manifest.json'))
const out = join(dir, 'dist')
mkdirSync(out, { recursive: true })
const langDir = join(dir, 'lang')
manifest.lang = {}
for (const f of readdirSync(langDir).filter((x) => x.endsWith('.json'))) manifest.lang[basename(f, '.json')] = readJson(join(langDir, f))
manifest.processor = 'processor.js'
writeFileSync(join(out, 'processor.js'), readFileSync(join(dir, 'src', 'processor.js')))
if (manifest.wasm) {
  const wasm = join(dir, manifest.wasm)
  if (!existsSync(wasm)) fail(`wasm が見つかりません: ${wasm}`)
  writeFileSync(join(out, basename(manifest.wasm)), readFileSync(wasm))
  manifest.wasm = basename(manifest.wasm)
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`出力しました: ${out}（配るのは manifest.json、processor.js${manifest.wasm ? `、${manifest.wasm}` : ''}）`)

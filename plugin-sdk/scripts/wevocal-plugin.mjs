// WeVocal プラグインのビルドの道具。使い方:
//   node wevocal-plugin.mjs create <フォルダー> <id>   雛形（template-processor）を写して、id を書き換える
//   node wevocal-plugin.mjs build <フォルダー>         manifest.json と lang/ をまとめて dist/ に出す（配るのは dist/ の中身）
//   node wevocal-plugin.mjs check <フォルダー>         マニフェストと processor の食い違いを調べる
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

if (!cmd || !dirArg || !['create', 'build', 'check'].includes(cmd)) fail('使い方: wevocal-plugin.mjs create|build|check <フォルダー> [id]')
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

const problems = check()
for (const p of problems) console.error(`- ${p}`)
if (cmd === 'check') process.exit(problems.length ? 1 : 0)
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

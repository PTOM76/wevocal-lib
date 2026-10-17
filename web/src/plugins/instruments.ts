// 音源のプラグイン（kind: 'instrument'）。MIDI の音符を鳴らして音にする。標準のシンセとサンプラー（processor 方式。外から足すものと同じ仕組み）と、音符の送り方
import { reportLoad, setOverloaded } from './registry'
import { loadModule, moduleKey, isReady, type PluginPackage } from './external'
import { processorName, type PluginManifest } from '../../../plugin-sdk'

/** 鳴らす音符（時刻は AudioContext の秒） */
export interface NoteEvent {
  time: number
  /** 長さ（秒）。この長さが過ぎたら離す */
  dur: number
  /** MIDI ノート番号 */
  pitch: number
  /** 強さ 0〜1 */
  vel: number
}

/** サンプラーが使う音（元の音のチャンネル） */
export interface SampleData {
  channels: Float32Array[]
  sampleRate: number
}

/** 音源のプラグイン（標準のものと、導入したもの） */
export interface InstrumentPlugin {
  manifest: PluginManifest
  /** 'ja_jp' → { key: 訳 } */
  lang: Record<string, Record<string, string>>
  pkg: PluginPackage
  /** 音色に使う元の音が要るか（サンプラー） */
  sample?: boolean
}

/** 実行中の音源 */
export interface InstrumentInstance {
  output: AudioNode
  update(values: Record<string, number>): void
  /** 音符を送る（時刻は ctx の秒。過ぎた時刻は、すぐ鳴らす）。先に送っておくと、その時刻に正確に鳴る */
  schedule(events: NoteEvent[]): void
  /** 今すぐ鳴らす、離す（キーボードのモニター） */
  noteOn(pitch: number, vel: number): void
  noteOff(pitch: number): void
  /** 送った音符をすべて取り消し、鳴っている音を離す */
  clear(): void
  setSample(sample: SampleData | null): void
  dispose(): void
}

/**
 * 音源の processor の土台（文字列）。音符の列（時刻順）を持ち、サンプル単位で時刻になったものから、startVoice と releaseVoice を呼ぶ。
 * port の受け取り: { __wevocalNotes: [{ time, dur, pitch, vel }] }、{ __wevocalNoteOn: { pitch, vel } }、{ __wevocalNoteOff: { pitch } }、
 * { __wevocalClear: true }、{ __wevocalSample: { channels, sampleRate } }
 */
const BASE = `
class WvInstrument extends AudioWorkletProcessor {
  constructor(o) {
    super()
    const opt = (o && o.processorOptions) || {}
    this.queue = []
    this.voices = []
    this.sample = opt.sample || null
    for (const ev of opt.events || []) this.addEvent(ev)
    this.port.onmessage = (e) => {
      const m = e.data
      if (m.__wevocalNotes) for (const ev of m.__wevocalNotes) this.addEvent(ev)
      else if (m.__wevocalNoteOn) this.push({ t: 0, on: true, pitch: m.__wevocalNoteOn.pitch, vel: m.__wevocalNoteOn.vel })
      else if (m.__wevocalNoteOff) this.push({ t: 0, on: false, pitch: m.__wevocalNoteOff.pitch })
      else if (m.__wevocalClear) {
        this.queue = []
        for (const v of this.voices) this.releaseVoice(v)
      } else if (m.__wevocalSample) this.sample = m.__wevocalSample
    }
  }
  push(ev) {
    // 時刻順に入れる（同じ時刻は入れた順）
    let i = this.queue.length
    while (i > 0 && this.queue[i - 1].t > ev.t) i--
    this.queue.splice(i, 0, ev)
  }
  addEvent(ev) {
    this.push({ t: ev.time, on: true, pitch: ev.pitch, vel: ev.vel })
    this.push({ t: ev.time + ev.dur, on: false, pitch: ev.pitch })
  }
  process(inputs, outputs, p) {
    const out = outputs[0]
    const n = out[0].length
    const L = out[0]
    const R = out[1] || out[0]
    for (let i = 0; i < n; i++) {
      const t = currentTime + i / sampleRate
      while (this.queue.length && this.queue[0].t <= t) {
        const ev = this.queue.shift()
        if (ev.on) this.startVoice(ev.pitch, ev.vel, p)
        else for (const v of this.voices) if (v.pitch === ev.pitch && !v.released) { this.releaseVoice(v); break }
      }
      let l = 0
      let r = 0
      for (const v of this.voices) {
        const s = this.renderVoice(v, p)
        l += s[0]
        r += s[1]
      }
      L[i] = l
      if (R !== L) R[i] = r
      // 終わった声を捨てる（まれにしか起きないので、毎サンプルは探さない）
      if (i === n - 1) this.voices = this.voices.filter((v) => !v.done)
    }
    return true
  }
}
`

const SYNTH = `
class SynthProcessor extends WvInstrument {
  static get parameterDescriptors() {
    return [
      { name: 'wave', defaultValue: 1, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 8, minValue: 0, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'decay', defaultValue: 200, minValue: 1, maxValue: 3000, automationRate: 'k-rate' },
      { name: 'sustain', defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 250, minValue: 1, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'cutoff', defaultValue: 6000, minValue: 100, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'detune', defaultValue: 6, minValue: 0, maxValue: 50, automationRate: 'k-rate' },
      { name: 'volume', defaultValue: -10, minValue: -48, maxValue: 6, automationRate: 'k-rate' },
    ]
  }
  startVoice(pitch, vel, p) {
    // 同時に鳴らせるのは 16 声まで（古いものから止める）
    if (this.voices.length >= 16) this.voices.shift()
    const f = 440 * Math.pow(2, (pitch - 69) / 12)
    this.voices.push({ pitch, f, vel, ph: 0, ph2: 0.37, env: 0, stage: 'a', released: false, done: false, lp: 0 })
  }
  releaseVoice(v) {
    v.released = true
    v.stage = 'r'
  }
  osc(w, ph) {
    switch (Math.round(w)) {
      case 0: return Math.sin(2 * Math.PI * ph)
      case 1: return 2 * ph - 1
      case 2: return ph < 0.5 ? 1 : -1
      default: return 4 * Math.abs(ph - 0.5) - 1
    }
  }
  renderVoice(v, p) {
    const sr = sampleRate
    const atk = Math.max(0.0005, p.attack[0] / 1000)
    const dec = Math.max(0.001, p.decay[0] / 1000)
    const rel = Math.max(0.001, p.release[0] / 1000)
    const sus = p.sustain[0]
    if (v.stage === 'a') {
      v.env += 1 / (atk * sr)
      if (v.env >= 1) { v.env = 1; v.stage = 'd' }
    } else if (v.stage === 'd') {
      v.env -= (1 - sus) / (dec * sr)
      if (v.env <= sus) { v.env = sus; v.stage = 's' }
    } else if (v.stage === 'r') {
      v.env -= Math.max(v.env, 0.001) / (rel * sr) * 4
      if (v.env <= 0.0005) { v.done = true; return [0, 0] }
    }
    const det = Math.pow(2, p.detune[0] / 1200)
    v.ph = (v.ph + v.f / sr) % 1
    v.ph2 = (v.ph2 + (v.f * det) / sr) % 1
    let s = (this.osc(p.wave[0], v.ph) + this.osc(p.wave[0], v.ph2)) * 0.5
    // 一次のローパス
    const a = 1 - Math.exp((-2 * Math.PI * Math.min(p.cutoff[0], sr * 0.45)) / sr)
    v.lp += a * (s - v.lp)
    s = v.lp * v.env * v.vel * Math.pow(10, p.volume[0] / 20)
    return [s, s]
  }
}
registerProcessor('wevocal-fx-wevocal-synth', SynthProcessor)
`

const SAMPLER = `
class SamplerProcessor extends WvInstrument {
  static get parameterDescriptors() {
    return [
      { name: 'root', defaultValue: 60, minValue: 0, maxValue: 127, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 3, minValue: 0, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 120, minValue: 1, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'loop', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'volume', defaultValue: 0, minValue: -48, maxValue: 12, automationRate: 'k-rate' },
    ]
  }
  startVoice(pitch, vel, p) {
    if (!this.sample) return
    if (this.voices.length >= 16) this.voices.shift()
    const rate = Math.pow(2, (pitch - p.root[0]) / 12) * (this.sample.sampleRate / sampleRate)
    this.voices.push({ pitch, rate, vel, pos: 0, env: 0, released: false, done: false })
  }
  releaseVoice(v) {
    v.released = true
  }
  renderVoice(v, p) {
    const smp = this.sample
    if (!smp) { v.done = true; return [0, 0] }
    const len = smp.channels[0].length
    const atk = Math.max(0.0005, p.attack[0] / 1000)
    const rel = Math.max(0.001, p.release[0] / 1000)
    if (v.released) {
      v.env -= 1 / (rel * sampleRate)
      if (v.env <= 0) { v.done = true; return [0, 0] }
    } else if (v.env < 1) v.env = Math.min(1, v.env + 1 / (atk * sampleRate))
    let pos = v.pos
    if (pos >= len - 1) {
      if (p.loop[0] >= 0.5 && !v.released) pos = v.pos = 0
      else { v.done = true; return [0, 0] }
    }
    const i = Math.floor(pos)
    const f = pos - i
    const ch = smp.channels
    const a = ch[0][i] * (1 - f) + ch[0][i + 1] * f
    const b = ch.length > 1 ? ch[1][i] * (1 - f) + ch[1][i + 1] * f : a
    v.pos += v.rate
    const g = v.env * v.vel * Math.pow(10, p.volume[0] / 20)
    return [a * g, b * g]
  }
}
registerProcessor('wevocal-fx-wevocal-sampler', SamplerProcessor)
`

const base = (id: string, name: string, params: PluginManifest['params'], lang: Record<string, Record<string, string>>): PluginManifest => ({
  id,
  api: 1,
  kind: 'instrument',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name,
  params,
  processor: 'processor.js',
  lang,
})

const synthManifest = base(
  'wevocal.synth',
  'name',
  [
    { id: 'wave', name: 'param.wave', min: 0, max: 3, default: 1, choices: ['wave.sine', 'wave.saw', 'wave.square', 'wave.triangle'] },
    { id: 'attack', name: 'param.attack', min: 0, max: 2000, default: 8, step: 1, unit: 'ms' },
    { id: 'decay', name: 'param.decay', min: 1, max: 3000, default: 200, step: 1, unit: 'ms' },
    { id: 'sustain', name: 'param.sustain', min: 0, max: 1, default: 0.6, step: 0.01, unit: '%' },
    { id: 'release', name: 'param.release', min: 1, max: 5000, default: 250, step: 1, unit: 'ms' },
    { id: 'cutoff', name: 'param.cutoff', min: 100, max: 20000, default: 6000, step: 10, unit: 'Hz', log: true },
    { id: 'detune', name: 'param.detune', min: 0, max: 50, default: 6, step: 0.5 },
    { id: 'volume', name: 'param.volume', min: -48, max: 6, default: -10, step: 0.5, unit: 'dB' },
  ],
  {
    ja_jp: { name: 'WevSynth', description: '波形から音を作る、基本のシンセサイザー', keywords: 'シンセ シンセサイザー', 'param.wave': '波形', 'wave.sine': 'サイン', 'wave.saw': 'ノコギリ', 'wave.square': '矩形', 'wave.triangle': '三角', 'param.attack': 'アタック', 'param.decay': 'ディケイ', 'param.sustain': 'サステイン', 'param.release': 'リリース', 'param.cutoff': 'カットオフ', 'param.detune': 'デチューン（セント）', 'param.volume': '音量' },
    en_us: { name: 'WevSynth', description: 'A basic synthesizer that builds sound from waveforms.', 'param.wave': 'Wave', 'wave.sine': 'Sine', 'wave.saw': 'Saw', 'wave.square': 'Square', 'wave.triangle': 'Triangle', 'param.attack': 'Attack', 'param.decay': 'Decay', 'param.sustain': 'Sustain', 'param.release': 'Release', 'param.cutoff': 'Cutoff', 'param.detune': 'Detune (cents)', 'param.volume': 'Volume' },
    ko_kr: { name: 'WevSynth', keywords: '신스', 'param.wave': '파형', 'wave.sine': '사인', 'wave.saw': '톱니', 'wave.square': '사각', 'wave.triangle': '삼각', 'param.attack': '어택', 'param.decay': '디케이', 'param.sustain': '서스테인', 'param.release': '릴리스', 'param.cutoff': '컷오프', 'param.detune': '디튠 (센트)', 'param.volume': '음량' },
    zh_cn: { name: 'WevSynth', keywords: '合成器', 'param.wave': '波形', 'wave.sine': '正弦', 'wave.saw': '锯齿', 'wave.square': '方波', 'wave.triangle': '三角', 'param.attack': '起音', 'param.decay': '衰减', 'param.sustain': '持续', 'param.release': '释放', 'param.cutoff': '截止', 'param.detune': '失谐（音分）', 'param.volume': '音量' },
    zh_tw: { name: 'WevSynth', keywords: '合成器', 'param.wave': '波形', 'wave.sine': '正弦', 'wave.saw': '鋸齒', 'wave.square': '方波', 'wave.triangle': '三角', 'param.attack': '起音', 'param.decay': '衰減', 'param.sustain': '持續', 'param.release': '釋放', 'param.cutoff': '截止', 'param.detune': '失諧（音分）', 'param.volume': '音量' },
  },
)

const samplerManifest = base(
  'wevocal.sampler',
  'name',
  [
    { id: 'root', name: 'param.root', min: 0, max: 127, default: 60, step: 1 },
    { id: 'attack', name: 'param.attack', min: 0, max: 2000, default: 3, step: 1, unit: 'ms' },
    { id: 'release', name: 'param.release', min: 1, max: 5000, default: 120, step: 1, unit: 'ms' },
    { id: 'loop', name: 'param.loop', min: 0, max: 1, default: 0, choices: ['loop.off', 'loop.on'] },
    { id: 'volume', name: 'param.volume', min: -48, max: 12, default: 0, step: 0.5, unit: 'dB' },
  ],
  {
    ja_jp: { name: 'WevSampler', description: '波形ブロックの音を音色にして、音符の高さに合わせて鳴らします', keywords: 'サンプラー', 'param.root': '元の音の高さ（MIDI ノート）', 'param.attack': 'アタック', 'param.release': 'リリース', 'param.loop': '繰り返し', 'loop.off': 'しない', 'loop.on': 'する', 'param.volume': '音量' },
    en_us: { name: 'WevSampler', description: 'Plays a waveform block\'s sound at the pitch of each note.', 'param.root': 'Root note (MIDI)', 'param.attack': 'Attack', 'param.release': 'Release', 'param.loop': 'Loop', 'loop.off': 'Off', 'loop.on': 'On', 'param.volume': 'Volume' },
    ko_kr: { name: 'WevSampler', keywords: '샘플러', 'param.root': '원음 높이 (MIDI 노트)', 'param.attack': '어택', 'param.release': '릴리스', 'param.loop': '반복', 'loop.off': '끄기', 'loop.on': '켜기', 'param.volume': '음량' },
    zh_cn: { name: 'WevSampler', keywords: '采样器', 'param.root': '原音音高（MIDI 音符）', 'param.attack': '起音', 'param.release': '释放', 'param.loop': '循环', 'loop.off': '关', 'loop.on': '开', 'param.volume': '音量' },
    zh_tw: { name: 'WevSampler', keywords: '取樣器', 'param.root': '原音音高（MIDI 音符）', 'param.attack': '起音', 'param.release': '釋放', 'param.loop': '循環', 'loop.off': '關', 'loop.on': '開', 'param.volume': '音量' },
  },
)

/** 標準の音源 */
export const STANDARD_INSTRUMENTS: InstrumentPlugin[] = [
  { manifest: synthManifest, lang: synthManifest.lang ?? {}, pkg: { manifest: synthManifest, processor: BASE + SYNTH } },
  { manifest: samplerManifest, lang: samplerManifest.lang ?? {}, pkg: { manifest: samplerManifest, processor: BASE + SAMPLER }, sample: true },
]

/** 導入した音源（store.ts が入れる） */
let installed: InstrumentPlugin[] = []
export const setInstalledInstruments = (list: InstrumentPlugin[]) => void (installed = list)
export const installedInstruments = () => installed

export const availableInstruments = () => [...STANDARD_INSTRUMENTS, ...installed]
export const findInstrument = (id: string) => availableInstruments().find((p) => p.manifest.id === id)

/** 音源の準備（processor の読み込み）。再生と書き出しの前に待つ */
export async function preloadInstruments(ctx: BaseAudioContext, ids: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(ids)].map((id) => findInstrument(id) && loadModule(ctx, findInstrument(id)!.pkg)))
}

/**
 * 音源を作る。events を渡すと、作った時点から送られた音符になる（書き出しは、レンダリングの前に全部を渡す）。
 * 読み込み済み（preloadInstruments のあと）なら、その場で作る
 */
export function createInstrument(ctx: BaseAudioContext, plugin: InstrumentPlugin, values: Record<string, number>, o: { events?: NoteEvent[]; sample?: SampleData | null } = {}): InstrumentInstance {
  const pkg = plugin.pkg
  const out = ctx.createGain()
  let node: AudioWorkletNode | null = null
  let disposed = false
  let latest = values
  const pending: unknown[] = []
  let streak = 0
  let overloaded = false

  const attach = () => {
    node = new AudioWorkletNode(ctx, processorName(pkg.manifest.id), {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { sampleRate: ctx.sampleRate, events: o.events ?? [], sample: o.sample ? { channels: o.sample.channels, sampleRate: o.sample.sampleRate } : null },
    })
    node.connect(out)
    node.port.onmessage = (e) => {
      const ratio = e.data?.__wevocalLoad
      if (typeof ratio !== 'number' || !(ctx instanceof AudioContext)) return
      reportLoad(pkg.manifest.id, ratio)
      streak = ratio > 0.9 ? streak + 1 : 0
      if (streak >= 3 && !overloaded) {
        overloaded = true
        setOverloaded(pkg.manifest.id, true)
        node?.disconnect()
      }
    }
    apply()
    for (const m of pending) node.port.postMessage(m)
    pending.length = 0
  }
  let applied = false
  const apply = () => {
    if (!node) return
    const now = ctx.currentTime
    // 最初は、ならさずにそのまま入れる
    for (const [id, x] of Object.entries(latest)) {
      if (applied) node.parameters.get(id)?.setTargetAtTime(x, now, 0.01)
      else node.parameters.get(id)?.setValueAtTime(x, now)
    }
    applied = true
  }
  const send = (m: unknown) => (node ? node.port.postMessage(m) : pending.push(m))

  if (isReady(ctx, moduleKey(pkg))) attach()
  else void loadModule(ctx, pkg).then((ok) => ok && !disposed && attach())

  return {
    output: out,
    update: (v) => {
      latest = v
      apply()
    },
    schedule: (events) => events.length && send({ __wevocalNotes: events }),
    noteOn: (pitch, vel) => send({ __wevocalNoteOn: { pitch, vel } }),
    noteOff: (pitch) => send({ __wevocalNoteOff: { pitch } }),
    clear: () => send({ __wevocalClear: true }),
    setSample: (s) => s && send({ __wevocalSample: { channels: s.channels, sampleRate: s.sampleRate } }),
    dispose: () => {
      disposed = true
      // processor を止める（external.ts の殻。外しただけでは動き続ける）
      node?.port.postMessage({ __wevocalDispose: true })
      node?.disconnect()
      out.disconnect()
    },
  }
}

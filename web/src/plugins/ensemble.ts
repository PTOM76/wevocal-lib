// 標準のプラグイン wevocal.chorus（2 声のコーラス）と wevocal.ensemble（最大 8 声を揺らして左右に広げる）。同じ作りで、声の数と広がりだけが違う
import { FxBase, SMOOTH } from '../../../plugin-sdk/FxBase'
import type { FxPlugin, HostInfo, ParamDef, PluginManifest } from '../../../plugin-sdk'

const MAX_VOICES = 8

const shared: ParamDef[] = [
  { id: 'rate', name: 'param.rate', min: 0.05, max: 8, default: 0.8, step: 0.01, unit: 'Hz', log: true },
  { id: 'depth', name: 'param.depth', min: 0, max: 1, default: 0.5, step: 0.01, unit: '%' },
  { id: 'delay', name: 'param.delay', min: 5, max: 40, default: 18, step: 0.5, unit: 'ms' },
]
const mix: ParamDef = { id: 'mix', name: 'param.mix', min: 0, max: 1, default: 0.5, step: 0.01, unit: '%' }

export const chorusManifest: PluginManifest = {
  id: 'wevocal.chorus',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [...shared, mix],
  tail: 0.1,
}

export const ensembleManifest: PluginManifest = {
  id: 'wevocal.ensemble',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [
    { id: 'voices', name: 'param.voices', min: 0, max: 6, default: 4, choices: ['voices.2', 'voices.3', 'voices.4', 'voices.5', 'voices.6', 'voices.7', 'voices.8'] },
    ...shared,
    { id: 'spread', name: 'param.spread', min: 0, max: 1, default: 0.8, step: 0.01, unit: '%' },
    { ...mix, default: 0.6 },
  ],
  tail: 0.1,
}

/** 揺らす声を重ねる。声ごとに遅れの基準と揺れの速さを少しずつ変えて、音が揃わないようにする */
class MultiVoice extends FxBase {
  private voices: { delay: DelayNode; lfo: OscillatorNode; depth: GainNode; level: GainNode; pan: StereoPannerNode }[] = []
  private wet!: GainNode
  private dry!: GainNode
  private readonly fixed: number | null

  constructor(ctx: BaseAudioContext, manifest: PluginManifest, host: HostInfo, fixed: number | null) {
    super(ctx, manifest, host)
    this.fixed = fixed
  }

  protected build() {
    this.wet = this.track(this.ctx.createGain())
    this.dry = this.track(this.ctx.createGain())
    this.src.connect(this.dry).connect(this.dst)
    this.wet.connect(this.dst)
    const n = this.fixed ?? MAX_VOICES
    for (let i = 0; i < n; i++) {
      const delay = this.track(this.ctx.createDelay(0.1))
      const lfo = this.track(this.ctx.createOscillator())
      const depth = this.track(this.ctx.createGain())
      const level = this.track(this.ctx.createGain())
      const pan = this.track(this.ctx.createStereoPanner())
      lfo.type = 'sine'
      lfo.connect(depth).connect(delay.delayTime)
      this.src.connect(delay).connect(level).connect(pan).connect(this.wet)
      lfo.start()
      this.voices.push({ delay, lfo, depth, level, pan })
    }
  }

  protected apply(v: Record<string, number>, now: number) {
    const active = this.fixed ?? Math.round(v.voices) + 2
    const spread = this.fixed ? 1 : v.spread
    const base = v.delay / 1000
    for (const [i, vo] of this.voices.entries()) {
      const on = i < active
      // 声ごとの遅れ（基準の 0.7〜1.3 倍）、揺れの速さ（±15%）、左右の位置
      const k = active > 1 ? i / (active - 1) : 0.5
      vo.delay.delayTime.setTargetAtTime(base * (0.7 + 0.6 * ((i * 0.618) % 1)), now, SMOOTH)
      vo.lfo.frequency.setTargetAtTime(v.rate * (0.85 + 0.3 * ((i * 0.37) % 1)), now, SMOOTH)
      vo.depth.gain.setTargetAtTime(base * 0.6 * v.depth, now, SMOOTH)
      vo.level.gain.setTargetAtTime(on ? 1 / Math.sqrt(active) : 0, now, SMOOTH)
      vo.pan.pan.setTargetAtTime((k * 2 - 1) * spread, now, SMOOTH)
    }
    this.wet.gain.setTargetAtTime(v.mix, now, SMOOTH)
    this.dry.gain.setTargetAtTime(1 - v.mix * 0.5, now, SMOOTH)
  }

  dispose() {
    for (const vo of this.voices) vo.lfo.stop()
    super.dispose()
  }
}

export const chorusPlugin: FxPlugin = {
  manifest: chorusManifest,
  lang: {
    ja_jp: { name: 'WevChorus', description: '少しずらした音を重ねて、広がりと厚みを足します', keywords: 'コーラス', 'param.rate': '速さ', 'param.depth': '深さ', 'param.delay': '遅れ', 'param.mix': 'ミックス' },
    en_us: { name: 'WevChorus', description: 'Adds width and thickness by layering slightly shifted copies.', 'param.rate': 'Rate', 'param.depth': 'Depth', 'param.delay': 'Delay', 'param.mix': 'Mix' },
    ko_kr: { name: 'WevChorus', keywords: '코러스', 'param.rate': '속도', 'param.depth': '깊이', 'param.delay': '지연', 'param.mix': '믹스' },
    zh_cn: { name: 'WevChorus', keywords: '合唱', 'param.rate': '速度', 'param.depth': '深度', 'param.delay': '延迟', 'param.mix': '混合' },
    zh_tw: { name: 'WevChorus', keywords: '合唱', 'param.rate': '速度', 'param.depth': '深度', 'param.delay': '延遲', 'param.mix': '混合' },
  },
  create: (ctx: BaseAudioContext, values: Record<string, number>, host: HostInfo, on = true) => new MultiVoice(ctx, chorusManifest, host, 2).init(values, on),
}

const voiceNames = (l: (n: number) => string) => Object.fromEntries([2, 3, 4, 5, 6, 7, 8].map((n) => [`voices.${n}`, l(n)]))

export const ensemblePlugin: FxPlugin = {
  manifest: ensembleManifest,
  lang: {
    ja_jp: { name: 'WevEnsemble', description: '揺らした声を最大 8 つ重ねて、合唱のように左右に広げます', keywords: 'アンサンブル', 'param.voices': '声の数', ...voiceNames((n) => `${n} 声`), 'param.rate': '速さ', 'param.depth': '深さ', 'param.delay': '遅れ', 'param.spread': '広がり', 'param.mix': 'ミックス' },
    en_us: { name: 'WevEnsemble', description: 'Layers up to 8 modulated voices and spreads them across the stereo field.', 'param.voices': 'Voices', ...voiceNames((n) => `${n} voices`), 'param.rate': 'Rate', 'param.depth': 'Depth', 'param.delay': 'Delay', 'param.spread': 'Spread', 'param.mix': 'Mix' },
    ko_kr: { name: 'WevEnsemble', keywords: '앙상블', 'param.voices': '성부 수', ...voiceNames((n) => `${n}성부`), 'param.rate': '속도', 'param.depth': '깊이', 'param.delay': '지연', 'param.spread': '확산', 'param.mix': '믹스' },
    zh_cn: { name: 'WevEnsemble', keywords: '合奏', 'param.voices': '声部数', ...voiceNames((n) => `${n} 声部`), 'param.rate': '速度', 'param.depth': '深度', 'param.delay': '延迟', 'param.spread': '宽度', 'param.mix': '混合' },
    zh_tw: { name: 'WevEnsemble', keywords: '合奏', 'param.voices': '聲部數', ...voiceNames((n) => `${n} 聲部`), 'param.rate': '速度', 'param.depth': '深度', 'param.delay': '延遲', 'param.spread': '寬度', 'param.mix': '混合' },
  },
  create: (ctx: BaseAudioContext, values: Record<string, number>, host: HostInfo, on = true) => new MultiVoice(ctx, ensembleManifest, host, null).init(values, on),
}

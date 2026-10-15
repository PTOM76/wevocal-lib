// 標準のプラグイン wevocal.delay（DelayNode とフィードバック、ローパス。テンポに合わせられる）
import { FxBase, SMOOTH } from '../../../plugin-sdk/FxBase'
import type { FxPlugin, HostInfo, PluginManifest } from '../../../plugin-sdk'

export const delayManifest: PluginManifest = {
  id: 'wevocal.delay',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [
    { id: 'sync', name: 'param.sync', min: 0, max: 4, default: 0, choices: ['sync.off', 'sync.quarter', 'sync.eighth', 'sync.dotted', 'sync.sixteenth'] },
    { id: 'time', name: 'param.time', min: 10, max: 2000, default: 300, step: 1, unit: 'ms' },
    { id: 'feedback', name: 'param.feedback', min: 0, max: 0.95, default: 0.35, step: 0.01, unit: '%' },
    { id: 'tone', name: 'param.tone', min: 1000, max: 20000, default: 8000, step: 10, unit: 'Hz', log: true },
    { id: 'mix', name: 'param.mix', min: 0, max: 1, default: 0.25, step: 0.01, unit: '%' },
  ],
  tail: 10,
}

/** 同期の選択肢ごとの長さ（拍）。index 0 はオフ */
const BEATS = [0, 1, 0.5, 0.75, 0.25]

/** 1 回の遅れ（秒）。同期がオフなら time、あればテンポから。DelayNode の上限 2 秒に収める */
export function delaySeconds(v: Record<string, number>, bpm: number): number {
  const beats = BEATS[Math.round(v.sync ?? 0)] ?? 0
  const sec = beats ? (60 / Math.max(1, bpm)) * beats : (v.time ?? 300) / 1000
  return Math.max(0.01, Math.min(2, sec))
}

/** 余韻の秒（繰り返しが -60 dB に下がるまで。上限 30 秒） */
export function delayTail(v: Record<string, number>, bpm: number): number {
  const fb = v.feedback ?? 0.35
  const t = delaySeconds(v, bpm)
  return fb <= 0 ? t : Math.min(30, t * (1 + Math.log(0.001) / Math.log(fb)))
}

class Delay extends FxBase {
  private delay!: DelayNode
  private feedback!: GainNode
  private tone!: BiquadFilterNode
  private wet!: GainNode
  private dry!: GainNode

  protected build() {
    this.delay = this.track(this.ctx.createDelay(2))
    this.feedback = this.track(this.ctx.createGain())
    this.tone = this.track(this.ctx.createBiquadFilter())
    this.tone.type = 'lowpass'
    this.wet = this.track(this.ctx.createGain())
    this.dry = this.track(this.ctx.createGain())
    this.src.connect(this.delay).connect(this.tone)
    this.tone.connect(this.feedback).connect(this.delay)
    this.tone.connect(this.wet).connect(this.dst)
    this.src.connect(this.dry).connect(this.dst)
  }

  protected apply(v: Record<string, number>, now: number) {
    this.delay.delayTime.setTargetAtTime(delaySeconds(v, this.host.bpm()), now, SMOOTH)
    this.feedback.gain.setTargetAtTime(v.feedback, now, SMOOTH)
    this.tone.frequency.setTargetAtTime(Math.min(v.tone, this.ctx.sampleRate / 2 - 1), now, SMOOTH)
    this.wet.gain.setTargetAtTime(v.mix, now, SMOOTH)
    this.dry.gain.setTargetAtTime(1 - v.mix, now, SMOOTH)
  }
}

export const delayPlugin: FxPlugin = {
  manifest: delayManifest,
  tail: delayTail,
  lang: {
    ja_jp: {
      name: 'ディレイ',
      'param.sync': 'テンポに合わせる',
      'sync.off': 'オフ',
      'sync.quarter': '1/4',
      'sync.eighth': '1/8',
      'sync.dotted': '付点 1/8',
      'sync.sixteenth': '1/16',
      'param.time': '間隔',
      'param.feedback': 'フィードバック',
      'param.tone': '音色',
      'param.mix': 'ミックス',
    },
    en_us: {
      name: 'Delay',
      'param.sync': 'Tempo sync',
      'sync.off': 'Off',
      'sync.quarter': '1/4',
      'sync.eighth': '1/8',
      'sync.dotted': 'Dotted 1/8',
      'sync.sixteenth': '1/16',
      'param.time': 'Time',
      'param.feedback': 'Feedback',
      'param.tone': 'Tone',
      'param.mix': 'Mix',
    },
  },
  create: (ctx: BaseAudioContext, values: Record<string, number>, host: HostInfo, on = true) => new Delay(ctx, delayManifest, host).init(values, on),
}

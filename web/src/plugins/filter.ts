// 標準のプラグイン wevocal.filter（ハイパス、ローパス、バンドパス、ノッチ。BiquadFilterNode。24 dB は 2 段にする）
import { FxBase, SMOOTH } from '../../../plugin-sdk/FxBase'
import type { FxPlugin, HostInfo, PluginManifest } from '../../../plugin-sdk'

export const filterManifest: PluginManifest = {
  id: 'wevocal.filter',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [
    { id: 'type', name: 'param.type', min: 0, max: 3, default: 0, choices: ['type.highpass', 'type.lowpass', 'type.bandpass', 'type.notch'] },
    { id: 'freq', name: 'param.freq', min: 20, max: 20000, default: 1000, step: 1, unit: 'Hz', log: true },
    { id: 'q', name: 'param.q', min: 0.1, max: 18, default: 0.71, step: 0.01 },
    { id: 'slope', name: 'param.slope', min: 0, max: 1, default: 0, choices: ['slope.12', 'slope.24'] },
  ],
  tail: 0,
}

const TYPES: BiquadFilterType[] = ['highpass', 'lowpass', 'bandpass', 'notch']

class Filter extends FxBase {
  private a!: BiquadFilterNode
  private b!: BiquadFilterNode
  /** 2 段目を通すか（24 dB のとき）。通さないときは 2 段目を飛ばす */
  private second!: GainNode
  private direct!: GainNode

  protected build() {
    this.a = this.track(this.ctx.createBiquadFilter())
    this.b = this.track(this.ctx.createBiquadFilter())
    this.second = this.track(this.ctx.createGain())
    this.direct = this.track(this.ctx.createGain())
    this.src.connect(this.a)
    this.a.connect(this.direct).connect(this.dst)
    this.a.connect(this.b).connect(this.second).connect(this.dst)
  }

  protected apply(v: Record<string, number>, now: number) {
    const type = TYPES[Math.round(v.type)]
    const f = Math.min(v.freq, this.ctx.sampleRate / 2 - 1)
    for (const n of [this.a, this.b]) {
      n.type = type
      n.frequency.setTargetAtTime(f, now, SMOOTH)
      n.Q.setTargetAtTime(v.q, now, SMOOTH)
    }
    const steep = Math.round(v.slope) === 1
    this.second.gain.setTargetAtTime(steep ? 1 : 0, now, SMOOTH)
    this.direct.gain.setTargetAtTime(steep ? 0 : 1, now, SMOOTH)
  }
}

export const filterPlugin: FxPlugin = {
  manifest: filterManifest,
  lang: {
    ja_jp: { name: 'WevFilter', description: '高域や低域を切る、特定の帯域を残す、削る（ハイパス、ローパス、バンドパス、ノッチ）', keywords: 'フィルター ハイパス ローパス', 'param.type': '種類', 'type.highpass': 'ハイパス', 'type.lowpass': 'ローパス', 'type.bandpass': 'バンドパス', 'type.notch': 'ノッチ', 'param.freq': '周波数', 'param.q': 'Q', 'param.slope': '傾き', 'slope.12': '12 dB/oct', 'slope.24': '24 dB/oct' },
    en_us: { name: 'WevFilter', description: 'High-pass, low-pass, band-pass and notch filters.', 'param.type': 'Type', 'type.highpass': 'High-pass', 'type.lowpass': 'Low-pass', 'type.bandpass': 'Band-pass', 'type.notch': 'Notch', 'param.freq': 'Frequency', 'param.q': 'Q', 'param.slope': 'Slope', 'slope.12': '12 dB/oct', 'slope.24': '24 dB/oct' },
    ko_kr: { name: 'WevFilter', keywords: '필터', 'param.type': '종류', 'type.highpass': '하이패스', 'type.lowpass': '로우패스', 'type.bandpass': '밴드패스', 'type.notch': '노치', 'param.freq': '주파수', 'param.q': 'Q', 'param.slope': '기울기', 'slope.12': '12 dB/oct', 'slope.24': '24 dB/oct' },
    zh_cn: { name: 'WevFilter', keywords: '滤波器', 'param.type': '类型', 'type.highpass': '高通', 'type.lowpass': '低通', 'type.bandpass': '带通', 'type.notch': '陷波', 'param.freq': '频率', 'param.q': 'Q', 'param.slope': '斜率', 'slope.12': '12 dB/oct', 'slope.24': '24 dB/oct' },
    zh_tw: { name: 'WevFilter', keywords: '濾波器', 'param.type': '類型', 'type.highpass': '高通', 'type.lowpass': '低通', 'type.bandpass': '帶通', 'type.notch': '陷波', 'param.freq': '頻率', 'param.q': 'Q', 'param.slope': '斜率', 'slope.12': '12 dB/oct', 'slope.24': '24 dB/oct' },
  },
  create: (ctx: BaseAudioContext, values: Record<string, number>, host: HostInfo, on = true) => new Filter(ctx, filterManifest, host).init(values, on),
}

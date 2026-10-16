// 標準のプラグイン wevocal.gate（ノイズゲート。小さい音を絞る。processor 方式なので、外から足すプラグインと同じ仕組みで動く）
import { makeExternalPlugin } from './external'
import type { PluginManifest } from '../../../plugin-sdk'

export const gateManifest: PluginManifest = {
  id: 'wevocal.gate',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [
    { id: 'threshold', name: 'param.threshold', min: -90, max: 0, default: -50, step: 0.5, unit: 'dB' },
    { id: 'range', name: 'param.range', min: -90, max: 0, default: -60, step: 0.5, unit: 'dB' },
    { id: 'attack', name: 'param.attack', min: 0.1, max: 100, default: 2, step: 0.1, unit: 'ms' },
    { id: 'hold', name: 'param.hold', min: 0, max: 500, default: 80, step: 1, unit: 'ms' },
    { id: 'release', name: 'param.release', min: 5, max: 1000, default: 150, step: 1, unit: 'ms' },
  ],
  tail: 0,
  processor: 'processor.js',
  lang: {
    ja_jp: { name: 'ノイズゲート', 'param.threshold': 'しきい値', 'param.range': '絞る量', 'param.attack': 'アタック', 'param.hold': 'ホールド', 'param.release': 'リリース' },
    en_us: { name: 'Noise gate', 'param.threshold': 'Threshold', 'param.range': 'Range', 'param.attack': 'Attack', 'param.hold': 'Hold', 'param.release': 'Release' },
    ko_kr: { name: '노이즈 게이트', 'param.threshold': '스레숄드', 'param.range': '감쇠량', 'param.attack': '어택', 'param.hold': '홀드', 'param.release': '릴리스' },
    zh_cn: { name: '噪声门', 'param.threshold': '阈值', 'param.range': '衰减量', 'param.attack': '启动', 'param.hold': '保持', 'param.release': '释放' },
    zh_tw: { name: '噪音閘', 'param.threshold': '臨界值', 'param.range': '衰減量', 'param.attack': '啟動', 'param.hold': '保持', 'param.release': '釋放' },
  },
}

/** AudioWorklet のソース。左右をつないで音の大きさを見て、しきい値を超えたら開き、下回って hold が過ぎたら閉じる */
const PROCESSOR = `
class GateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -50, minValue: -90, maxValue: 0, automationRate: 'k-rate' },
      { name: 'range', defaultValue: -60, minValue: -90, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 2, minValue: 0.1, maxValue: 100, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 80, minValue: 0, maxValue: 500, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 150, minValue: 5, maxValue: 1000, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    this.level = 0
    this.gain = 0
    this.holdLeft = 0
  }
  process(inputs, outputs, p) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input.length) return true
    const open = Math.pow(10, p.threshold[0] / 20)
    const close = open * 0.7
    const floor = Math.pow(10, p.range[0] / 20)
    const up = 1 - Math.exp(-1 / (sampleRate * p.attack[0] / 1000))
    const down = 1 - Math.exp(-1 / (sampleRate * p.release[0] / 1000))
    const hold = Math.floor(sampleRate * p.hold[0] / 1000)
    const detDown = 1 - Math.exp(-1 / (sampleRate * 0.005))
    const n = input[0].length
    for (let i = 0; i < n; i++) {
      let a = 0
      for (let c = 0; c < input.length; c++) a = Math.max(a, Math.abs(input[c][i]))
      this.level = a > this.level ? a : this.level + (a - this.level) * detDown
      if (this.level >= open) this.holdLeft = hold
      else if (this.holdLeft > 0 && this.level < close) this.holdLeft--
      const target = this.level >= open || this.holdLeft > 0 ? 1 : floor
      this.gain += (target - this.gain) * (target > this.gain ? up : down)
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] || input[0])[i] * this.gain
    }
    return true
  }
}
registerProcessor('wevocal-fx-wevocal-gate', GateProcessor)
`

export const gatePlugin = makeExternalPlugin({ manifest: gateManifest, processor: PROCESSOR })

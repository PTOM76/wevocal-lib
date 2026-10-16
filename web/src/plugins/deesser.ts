// 標準のプラグイン wevocal.deesser（帯域を二つに分け、高い側だけを圧縮して戻す。サ行の刺さる高域を抑える。processor 方式）
import { makeExternalPlugin } from './external'
import type { PluginManifest } from '../../../plugin-sdk'

export const deesserManifest: PluginManifest = {
  id: 'wevocal.deesser',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [
    { id: 'freq', name: 'param.freq', min: 2000, max: 12000, default: 6000, step: 50, unit: 'Hz', log: true },
    { id: 'threshold', name: 'param.threshold', min: -60, max: 0, default: -30, step: 0.5, unit: 'dB' },
    { id: 'ratio', name: 'param.ratio', min: 1, max: 20, default: 6, step: 0.1 },
    { id: 'release', name: 'param.release', min: 10, max: 300, default: 60, step: 1, unit: 'ms' },
  ],
  tail: 0,
  processor: 'processor.js',
  lang: {
    ja_jp: { name: 'ディエッサー', 'param.freq': '周波数', 'param.threshold': 'しきい値', 'param.ratio': 'レシオ', 'param.release': 'リリース' },
    en_us: { name: 'De-esser', 'param.freq': 'Frequency', 'param.threshold': 'Threshold', 'param.ratio': 'Ratio', 'param.release': 'Release' },
    ko_kr: { name: '디에서', 'param.freq': '주파수', 'param.threshold': '스레숄드', 'param.ratio': '레이쇼', 'param.release': '릴리스' },
    zh_cn: { name: '去齿音器', 'param.freq': '频率', 'param.threshold': '阈值', 'param.ratio': '压缩比', 'param.release': '释放' },
    zh_tw: { name: '去齒音器', 'param.freq': '頻率', 'param.threshold': '臨界值', 'param.ratio': '壓縮比', 'param.release': '釋放' },
  },
}

/**
 * AudioWorklet のソース。4 次（2 次を 2 段）のローパスとハイパスで分け、高い側の大きさ（左右でそろえる）がしきい値を超えたぶんだけ、
 * レシオに従って高い側だけを下げて足し戻す。Web Audio の圧縮は自動で音量が上がるので、使わない
 */
const PROCESSOR = `
class DeesserProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'freq', defaultValue: 6000, minValue: 2000, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: -30, minValue: -60, maxValue: 0, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 6, minValue: 1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 60, minValue: 10, maxValue: 300, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    this.f0 = 0
    this.c = null
    // 左右それぞれ、ローパス 2 段とハイパス 2 段の状態（z1, z2）
    this.z = [0, 1].map(() => [0, 1, 2, 3].map(() => [0, 0]))
    this.env = 0
  }
  coef(freq) {
    const w = 2 * Math.PI * Math.min(freq, sampleRate * 0.45) / sampleRate
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
    const a0 = 1 + alpha
    const a1 = (-2 * cos) / a0
    const a2 = (1 - alpha) / a0
    const lb0 = (1 - cos) / 2 / a0
    const hb0 = (1 + cos) / 2 / a0
    return { lp: [lb0, 2 * lb0, lb0, a1, a2], hp: [hb0, -2 * hb0, hb0, a1, a2] }
  }
  biquad(k, z, x) {
    const y = k[0] * x + z[0]
    z[0] = k[1] * x - k[3] * y + z[1]
    z[1] = k[2] * x - k[4] * y
    return y
  }
  process(inputs, outputs, p) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input.length) return true
    if (p.freq[0] !== this.f0) {
      this.f0 = p.freq[0]
      this.c = this.coef(this.f0)
    }
    const thr = p.threshold[0]
    const slope = 1 - 1 / p.ratio[0]
    const rel = 1 - Math.exp(-1 / (sampleRate * p.release[0] / 1000))
    const atk = 1 - Math.exp(-1 / (sampleRate * 0.001))
    const n = input[0].length
    const lows = []
    const highs = []
    for (let c = 0; c < output.length; c++) {
      const src = input[c] || input[0]
      const z = this.z[Math.min(c, 1)]
      const lo = new Float32Array(n)
      const hi = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        lo[i] = this.biquad(this.c.lp, z[1], this.biquad(this.c.lp, z[0], src[i]))
        hi[i] = this.biquad(this.c.hp, z[3], this.biquad(this.c.hp, z[2], src[i]))
      }
      lows.push(lo)
      highs.push(hi)
    }
    for (let i = 0; i < n; i++) {
      let a = 0
      for (let c = 0; c < highs.length; c++) a = Math.max(a, Math.abs(highs[c][i]))
      this.env += (a - this.env) * (a > this.env ? atk : rel)
      const db = 20 * Math.log10(this.env + 1e-9)
      const g = db > thr ? Math.pow(10, (-(db - thr) * slope) / 20) : 1
      for (let c = 0; c < output.length; c++) output[c][i] = lows[c][i] + highs[c][i] * g
    }
    return true
  }
}
registerProcessor('wevocal-fx-wevocal-deesser', DeesserProcessor)
`

export const deesserPlugin = makeExternalPlugin({ manifest: deesserManifest, processor: PROCESSOR })

// 標準のプラグイン wevocal.sidechain（サイドチェーン付きのコンプレッサー。ほかのトラックの音の大きさで、このトラックを下げる。processor 方式）
import { makeExternalPlugin } from './external'
import type { PluginManifest } from '../../../plugin-sdk'

export const sidechainManifest: PluginManifest = {
  id: 'wevocal.sidechain',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  sidechain: true,
  params: [
    { id: 'threshold', name: 'param.threshold', min: -60, max: 0, default: -30, step: 0.5, unit: 'dB' },
    { id: 'ratio', name: 'param.ratio', min: 1, max: 20, default: 8, step: 0.1 },
    { id: 'attack', name: 'param.attack', min: 0.1, max: 100, default: 5, step: 0.1, unit: 'ms' },
    { id: 'release', name: 'param.release', min: 10, max: 1000, default: 200, step: 1, unit: 'ms' },
    { id: 'makeup', name: 'param.makeup', min: 0, max: 24, default: 0, step: 0.5, unit: 'dB' },
  ],
  tail: 0,
  processor: 'processor.js',
  lang: {
    ja_jp: { name: 'サイドチェーン・コンプレッサー', 'param.threshold': 'しきい値', 'param.ratio': 'レシオ', 'param.attack': 'アタック', 'param.release': 'リリース', 'param.makeup': 'メイクアップ' },
    en_us: { name: 'Sidechain compressor', 'param.threshold': 'Threshold', 'param.ratio': 'Ratio', 'param.attack': 'Attack', 'param.release': 'Release', 'param.makeup': 'Makeup' },
    ko_kr: { name: '사이드체인 컴프레서', 'param.threshold': '스레숄드', 'param.ratio': '레이쇼', 'param.attack': '어택', 'param.release': '릴리스', 'param.makeup': '메이크업' },
    zh_cn: { name: '侧链压缩器', 'param.threshold': '阈值', 'param.ratio': '压缩比', 'param.attack': '启动', 'param.release': '释放', 'param.makeup': '补偿增益' },
    zh_tw: { name: '側鏈壓縮器', 'param.threshold': '臨界值', 'param.ratio': '壓縮比', 'param.attack': '啟動', 'param.release': '釋放', 'param.makeup': '補償增益' },
  },
}

/**
 * AudioWorklet のソース。2 番目の入力（サイドチェーン）の大きさを見て、1 番目の入力の音を下げる。
 * 2 番目の入力に何もつながっていないときは、1 番目の入力の大きさで見る（普通のコンプレッサーになる）
 */
const PROCESSOR = `
class SidechainProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -30, minValue: -60, maxValue: 0, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 8, minValue: 1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 5, minValue: 0.1, maxValue: 100, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 200, minValue: 10, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'makeup', defaultValue: 0, minValue: 0, maxValue: 24, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    this.env = 0
    this.gr = 0
  }
  process(inputs, outputs, p) {
    const main = inputs[0]
    const output = outputs[0]
    if (!main.length) return true
    const side = inputs[1] && inputs[1].length ? inputs[1] : main
    const thr = p.threshold[0]
    const slope = 1 - 1 / p.ratio[0]
    const up = 1 - Math.exp(-1 / (sampleRate * p.attack[0] / 1000))
    const down = 1 - Math.exp(-1 / (sampleRate * p.release[0] / 1000))
    const makeup = Math.pow(10, p.makeup[0] / 20)
    const n = main[0].length
    for (let i = 0; i < n; i++) {
      let a = 0
      for (let c = 0; c < side.length; c++) a = Math.max(a, Math.abs(side[c][i]))
      // 大きさは速く追い、戻りはリリースで（検出は瞬時、下げ量でなめらかにする）
      this.env = a > this.env ? a : this.env + (a - this.env) * 0.002
      const db = 20 * Math.log10(this.env + 1e-9)
      const target = db > thr ? (db - thr) * slope : 0
      this.gr += (target - this.gr) * (target > this.gr ? up : down)
      const g = Math.pow(10, -this.gr / 20) * makeup
      for (let c = 0; c < output.length; c++) output[c][i] = (main[c] || main[0])[i] * g
    }
    return true
  }
}
registerProcessor('wevocal-fx-wevocal-sidechain', SidechainProcessor)
`

export const sidechainPlugin = makeExternalPlugin({ manifest: sidechainManifest, processor: PROCESSOR })

// 標準のプラグイン wevocal.compressor（DynamicsCompressorNode とメイクアップのゲイン）
import { FxBase, SMOOTH } from '../../../plugin-sdk/FxBase'
import type { FxPlugin, HostInfo, PluginManifest } from '../../../plugin-sdk'

export const compressorManifest: PluginManifest = {
  id: 'wevocal.compressor',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [
    { id: 'threshold', name: 'param.threshold', min: -60, max: 0, default: -24, step: 0.5, unit: 'dB' },
    { id: 'ratio', name: 'param.ratio', min: 1, max: 20, default: 4, step: 0.1 },
    { id: 'attack', name: 'param.attack', min: 0, max: 100, default: 10, step: 1, unit: 'ms' },
    { id: 'release', name: 'param.release', min: 10, max: 1000, default: 250, step: 5, unit: 'ms' },
    { id: 'knee', name: 'param.knee', min: 0, max: 40, default: 6, step: 1, unit: 'dB' },
    { id: 'makeup', name: 'param.makeup', min: 0, max: 24, default: 0, step: 0.5, unit: 'dB' },
  ],
  tail: 0,
}

class Compressor extends FxBase {
  private comp!: DynamicsCompressorNode
  private makeup!: GainNode

  protected build() {
    this.comp = this.track(this.ctx.createDynamicsCompressor())
    this.makeup = this.track(this.ctx.createGain())
    this.src.connect(this.comp).connect(this.makeup).connect(this.dst)
  }

  protected apply(v: Record<string, number>, now: number) {
    const c = this.comp
    c.threshold.setTargetAtTime(v.threshold, now, SMOOTH)
    c.ratio.setTargetAtTime(v.ratio, now, SMOOTH)
    c.attack.setTargetAtTime(v.attack / 1000, now, SMOOTH)
    c.release.setTargetAtTime(v.release / 1000, now, SMOOTH)
    c.knee.setTargetAtTime(v.knee, now, SMOOTH)
    this.makeup.gain.setTargetAtTime(10 ** (v.makeup / 20), now, SMOOTH)
  }
}

export const compressorPlugin: FxPlugin = {
  manifest: compressorManifest,
  lang: {
    ja_jp: {
      name: 'WevCompressor', description: '大きい音を抑えて、音量をそろえます', keywords: 'コンプレッサー',
      'param.threshold': 'しきい値',
      'param.ratio': 'レシオ',
      'param.attack': 'アタック',
      'param.release': 'リリース',
      'param.knee': 'ニー',
      'param.makeup': 'メイクアップ',
    },
    en_us: { name: 'WevCompressor', description: 'Reduces loud peaks to even out the level.', 'param.threshold': 'Threshold', 'param.ratio': 'Ratio', 'param.attack': 'Attack', 'param.release': 'Release', 'param.knee': 'Knee', 'param.makeup': 'Makeup' },
    ko_kr: { name: 'WevCompressor', keywords: '컴프레서', 'param.threshold': '스레숄드', 'param.ratio': '레이쇼', 'param.attack': '어택', 'param.release': '릴리스', 'param.knee': '니', 'param.makeup': '메이크업' },
    zh_cn: { name: 'WevCompressor', keywords: '压缩器', 'param.threshold': '阈值', 'param.ratio': '压缩比', 'param.attack': '启动', 'param.release': '释放', 'param.knee': '拐点', 'param.makeup': '补偿增益' },
    zh_tw: { name: 'WevCompressor', keywords: '壓縮器', 'param.threshold': '臨界值', 'param.ratio': '壓縮比', 'param.attack': '啟動', 'param.release': '釋放', 'param.knee': '拐點', 'param.makeup': '補償增益' },
  },
  create: (ctx: BaseAudioContext, values: Record<string, number>, host: HostInfo, on = true) => new Compressor(ctx, compressorManifest, host).init(values, on),
}

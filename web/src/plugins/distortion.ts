// 標準のプラグイン wevocal.distortion（WaveShaperNode のソフトクリップ。4 倍のオーバーサンプリングで折り返しを抑える）
import { FxBase, SMOOTH } from '../../../plugin-sdk/FxBase'
import type { FxPlugin, HostInfo, PluginManifest } from '../../../plugin-sdk'

export const distortionManifest: PluginManifest = {
  id: 'wevocal.distortion',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [
    { id: 'drive', name: 'param.drive', min: 0, max: 40, default: 12, step: 0.5, unit: 'dB' },
    { id: 'shape', name: 'param.shape', min: 0, max: 2, default: 0, choices: ['shape.soft', 'shape.hard', 'shape.fold'] },
    { id: 'tone', name: 'param.tone', min: 500, max: 20000, default: 8000, step: 10, unit: 'Hz', log: true },
    { id: 'level', name: 'param.level', min: -24, max: 6, default: -6, step: 0.5, unit: 'dB' },
    { id: 'mix', name: 'param.mix', min: 0, max: 1, default: 1, step: 0.01, unit: '%' },
  ],
  tail: 0,
}

/** 波形の曲線（-1〜1 を 4096 点で）。soft は tanh、hard は折れ線で切る、fold は折り返す */
function curve(kind: number): Float32Array<ArrayBuffer> {
  const n = 4096
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = kind === 1 ? Math.max(-0.8, Math.min(0.8, x)) / 0.8 : kind === 2 ? Math.sin(x * Math.PI * 0.5) : Math.tanh(x * 2) / Math.tanh(2)
  }
  return c
}

class Distortion extends FxBase {
  private pre!: GainNode
  private shaper!: WaveShaperNode
  private tone!: BiquadFilterNode
  private level!: GainNode
  private wet!: GainNode
  private dry!: GainNode
  private shapeKey = -1

  protected build() {
    this.pre = this.track(this.ctx.createGain())
    this.shaper = this.track(this.ctx.createWaveShaper())
    this.shaper.oversample = '4x'
    this.tone = this.track(this.ctx.createBiquadFilter())
    this.tone.type = 'lowpass'
    this.level = this.track(this.ctx.createGain())
    this.wet = this.track(this.ctx.createGain())
    this.dry = this.track(this.ctx.createGain())
    this.src.connect(this.pre).connect(this.shaper).connect(this.tone).connect(this.level).connect(this.wet).connect(this.dst)
    this.src.connect(this.dry).connect(this.dst)
  }

  protected apply(v: Record<string, number>, now: number) {
    const shape = Math.round(v.shape)
    if (shape !== this.shapeKey) {
      this.shaper.curve = curve(shape)
      this.shapeKey = shape
    }
    this.pre.gain.setTargetAtTime(10 ** (v.drive / 20), now, SMOOTH)
    this.tone.frequency.setTargetAtTime(Math.min(v.tone, this.ctx.sampleRate / 2 - 1), now, SMOOTH)
    this.level.gain.setTargetAtTime(10 ** (v.level / 20), now, SMOOTH)
    this.wet.gain.setTargetAtTime(v.mix, now, SMOOTH)
    this.dry.gain.setTargetAtTime(1 - v.mix, now, SMOOTH)
  }
}

export const distortionPlugin: FxPlugin = {
  manifest: distortionManifest,
  lang: {
    ja_jp: { name: 'WevDistortion', description: '音を歪ませて、太さや荒さを足します', keywords: 'ディストーション 歪み', 'param.drive': 'ドライブ', 'param.shape': '種類', 'shape.soft': 'ソフト', 'shape.hard': 'ハード', 'shape.fold': 'フォールド', 'param.tone': '音色', 'param.level': '出力', 'param.mix': 'ミックス' },
    en_us: { name: 'WevDistortion', description: 'Adds thickness or grit by distorting the sound.', 'param.drive': 'Drive', 'param.shape': 'Shape', 'shape.soft': 'Soft', 'shape.hard': 'Hard', 'shape.fold': 'Fold', 'param.tone': 'Tone', 'param.level': 'Level', 'param.mix': 'Mix' },
    ko_kr: { name: 'WevDistortion', keywords: '디스토션', 'param.drive': '드라이브', 'param.shape': '종류', 'shape.soft': '소프트', 'shape.hard': '하드', 'shape.fold': '폴드', 'param.tone': '톤', 'param.level': '출력', 'param.mix': '믹스' },
    zh_cn: { name: 'WevDistortion', keywords: '失真', 'param.drive': '驱动', 'param.shape': '类型', 'shape.soft': '柔和', 'shape.hard': '硬', 'shape.fold': '折叠', 'param.tone': '音色', 'param.level': '输出', 'param.mix': '混合' },
    zh_tw: { name: 'WevDistortion', keywords: '失真', 'param.drive': '驅動', 'param.shape': '類型', 'shape.soft': '柔和', 'shape.hard': '硬', 'shape.fold': '摺疊', 'param.tone': '音色', 'param.level': '輸出', 'param.mix': '混合' },
  },
  create: (ctx: BaseAudioContext, values: Record<string, number>, host: HostInfo, on = true) => new Distortion(ctx, distortionManifest, host).init(values, on),
}

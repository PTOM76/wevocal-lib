// 標準のプラグイン wevocal.reverb（ConvolverNode。インパルス応答は計算で作るので、同梱せず容量が増えない）
import { FxBase, SMOOTH } from '../../../plugin-sdk/FxBase'
import type { FxPlugin, HostInfo, PluginManifest } from '../../../plugin-sdk'

export const reverbManifest: PluginManifest = {
  id: 'wevocal.reverb',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [
    { id: 'type', name: 'param.type', min: 0, max: 2, default: 1, choices: ['type.room', 'type.hall', 'type.plate'] },
    { id: 'size', name: 'param.size', min: 0, max: 1, default: 0.5, step: 0.01, unit: '%' },
    { id: 'damp', name: 'param.damp', min: 0, max: 1, default: 0.5, step: 0.01, unit: '%' },
    { id: 'mix', name: 'param.mix', min: 0, max: 1, default: 0.25, step: 0.01, unit: '%' },
    { id: 'predelay', name: 'param.predelay', min: 0, max: 100, default: 10, step: 1, unit: 'ms' },
  ],
  tail: 4.1,
}

/** 種類ごとの長さの倍率と、響きの密度の違い（部屋は短く、ホールは長く、プレートは明るく密） */
const KINDS = [
  { length: 0.5, bright: 0.8 },
  { length: 1, bright: 0.6 },
  { length: 0.8, bright: 1 },
] as const

/** IR の長さ（秒）。size 0〜1 で 0.3〜4 秒（種類で縮める） */
export const irSeconds = (type: number, size: number) => Math.max(0.3, (0.3 + size * 3.7) * KINDS[type].length)

/** 余韻の秒（IR の長さ＋プリディレイ） */
export const reverbTail = (v: Record<string, number>) => irSeconds(Math.round(v.type ?? 1), v.size ?? 0.5) + (v.predelay ?? 10) / 1000

/** 同じ値なら同じ音になるよう、種を決めた乱数（書き出しと再生で IR を一致させる） */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

/** ステレオの、指数で減衰する雑音。時間とともに高域を落とす（-60 dB で終わる） */
export function makeImpulse(ctx: BaseAudioContext, type: number, size: number): AudioBuffer {
  const len = irSeconds(type, size)
  const frames = Math.floor(len * ctx.sampleRate)
  const buf = ctx.createBuffer(2, frames, ctx.sampleRate)
  const k = Math.log(1000) / len
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c)
    const rand = rng(1000 + type * 7 + c)
    let y = 0
    for (let i = 0; i < frames; i++) {
      const t = i / ctx.sampleRate
      // 時間とともに一次のローパスを強める
      const a = 1 - (1 - KINDS[type].bright) * Math.min(1, t / len) * 0.9
      y += a * (rand() - y)
      data[i] = y * Math.exp(-k * t)
    }
  }
  return buf
}

class Reverb extends FxBase {
  private pre!: DelayNode
  private conv!: ConvolverNode
  private tone!: BiquadFilterNode
  private wet!: GainNode
  private dry!: GainNode
  /** 今の IR の種類と大きさ（変わったときだけ作り直す） */
  private irKey = ''

  protected build() {
    this.pre = this.track(this.ctx.createDelay(0.2))
    this.conv = this.track(this.ctx.createConvolver())
    this.tone = this.track(this.ctx.createBiquadFilter())
    this.tone.type = 'lowpass'
    this.wet = this.track(this.ctx.createGain())
    this.dry = this.track(this.ctx.createGain())
    this.src.connect(this.pre).connect(this.conv).connect(this.tone).connect(this.wet).connect(this.dst)
    this.src.connect(this.dry).connect(this.dst)
  }

  protected apply(v: Record<string, number>, now: number) {
    const type = Math.round(v.type)
    const key = `${type}:${v.size}`
    if (key !== this.irKey) {
      this.conv.buffer = makeImpulse(this.ctx, type, v.size)
      this.irKey = key
    }
    this.pre.delayTime.setTargetAtTime(v.predelay / 1000, now, SMOOTH)
    // 高域の減衰（damp が大きいほど暗い）
    this.tone.frequency.setTargetAtTime(Math.min(this.ctx.sampleRate / 2 - 1, 1500 + (1 - v.damp) ** 2 * 18500), now, SMOOTH)
    this.wet.gain.setTargetAtTime(v.mix, now, SMOOTH)
    this.dry.gain.setTargetAtTime(1 - v.mix, now, SMOOTH)
  }
}

export const reverbPlugin: FxPlugin = {
  manifest: reverbManifest,
  tail: reverbTail,
  lang: {
    ja_jp: {
      name: 'リバーブ',
      'param.type': '種類',
      'type.room': '部屋',
      'type.hall': 'ホール',
      'type.plate': 'プレート',
      'param.size': '大きさ',
      'param.damp': '高域の減衰',
      'param.mix': 'ミックス',
      'param.predelay': 'プリディレイ',
    },
    en_us: {
      name: 'Reverb',
      'param.type': 'Type',
      'type.room': 'Room',
      'type.hall': 'Hall',
      'type.plate': 'Plate',
      'param.size': 'Size',
      'param.damp': 'Damping',
      'param.mix': 'Mix',
      'param.predelay': 'Pre-delay',
    },
    ko_kr: { name: '리버브', 'param.type': '종류', 'type.room': '룸', 'type.hall': '홀', 'type.plate': '플레이트', 'param.size': '크기', 'param.damp': '고역 감쇠', 'param.mix': '믹스', 'param.predelay': '프리 딜레이' },
    zh_cn: { name: '混响', 'param.type': '类型', 'type.room': '房间', 'type.hall': '大厅', 'type.plate': '板式', 'param.size': '大小', 'param.damp': '高频衰减', 'param.mix': '混合', 'param.predelay': '预延迟' },
    zh_tw: { name: '殘響', 'param.type': '類型', 'type.room': '房間', 'type.hall': '大廳', 'type.plate': '板式', 'param.size': '大小', 'param.damp': '高頻衰減', 'param.mix': '混合', 'param.predelay': '預延遲' },
  },
  create: (ctx: BaseAudioContext, values: Record<string, number>, host: HostInfo, on = true) => new Reverb(ctx, reverbManifest, host).init(values, on),
}

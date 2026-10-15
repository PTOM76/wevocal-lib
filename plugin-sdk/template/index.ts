// 雛形のプラグイン wevocal.template（つまみが 1 つ。作る人の見本と、枠組みの確かめに使う）。アプリの「追加」の一覧には出さない
import { FxBase } from '../FxBase'
import type { FxPlugin, HostInfo, PluginManifest } from '../types'

export const templateManifest: PluginManifest = {
  id: 'wevocal.template',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [{ id: 'gain', name: 'param.gain', min: -24, max: 24, default: 0, step: 0.1, unit: 'dB' }],
  tail: 0,
}

/** 音量を dB で変えるだけ */
class Template extends FxBase {
  private gain!: GainNode

  protected build() {
    this.gain = this.track(this.ctx.createGain())
    this.src.connect(this.gain).connect(this.dst)
  }

  protected apply(v: Record<string, number>, now: number) {
    this.gain.gain.setTargetAtTime(10 ** (v.gain / 20), now, 0.01)
  }
}

export const templatePlugin: FxPlugin = {
  manifest: templateManifest,
  lang: {
    ja_jp: { name: '雛形', 'param.gain': 'ゲイン' },
    en_us: { name: 'Template', 'param.gain': 'Gain' },
  },
  create: (ctx: BaseAudioContext, values: Record<string, number>, host: HostInfo, on = true) => new Template(ctx, templateManifest, host).init(values, on),
}

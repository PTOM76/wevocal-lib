// 標準のプラグイン wevocal.limiter（limitedOutput と同じ作り。DynamicsCompressorNode で天井を決める）
import { FxBase, SMOOTH } from '../../../plugin-sdk/FxBase'
import type { FxPlugin, HostInfo, PluginManifest } from '../../../plugin-sdk'

export const limiterManifest: PluginManifest = {
  id: 'wevocal.limiter',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  params: [
    { id: 'ceiling', name: 'param.ceiling', min: -12, max: 0, default: -1, step: 0.1, unit: 'dB' },
    { id: 'release', name: 'param.release', min: 10, max: 1000, default: 100, step: 5, unit: 'ms' },
  ],
  tail: 0,
}

class Limiter extends FxBase {
  private comp!: DynamicsCompressorNode

  protected build() {
    this.comp = this.track(this.ctx.createDynamicsCompressor())
    this.comp.knee.value = 0
    this.comp.ratio.value = 20
    this.comp.attack.value = 0.001
    this.src.connect(this.comp).connect(this.dst)
  }

  protected apply(v: Record<string, number>, now: number) {
    this.comp.threshold.setTargetAtTime(v.ceiling, now, SMOOTH)
    this.comp.release.setTargetAtTime(v.release / 1000, now, SMOOTH)
  }
}

export const limiterPlugin: FxPlugin = {
  manifest: limiterManifest,
  lang: {
    ja_jp: { name: 'リミッター', 'param.ceiling': '天井', 'param.release': 'リリース' },
    en_us: { name: 'Limiter', 'param.ceiling': 'Ceiling', 'param.release': 'Release' },
  },
  create: (ctx: BaseAudioContext, values: Record<string, number>, host: HostInfo, on = true) => new Limiter(ctx, limiterManifest, host).init(values, on),
}

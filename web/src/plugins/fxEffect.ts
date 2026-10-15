// FX の列を Effect の形にする（Synth の効果の表に載せる。再生は createFxChain、書き出しは OfflineAudioContext に同じ列を組む）
import type { Clip } from '../types'
import type { Effect } from '../effects/types'
import type { FxSlot, HostInfo } from '../../../plugin-sdk'
import { createFxChain, isNeutralChain } from './host'

/** 音声に FX の列を掛ける（余韻は足さず、長さは元のまま） */
export async function applyFx(clip: Clip, slots: FxSlot[], host: HostInfo): Promise<Clip> {
  const len = clip.channels[0]?.length ?? 0
  if (!len || isNeutralChain(slots)) return clip
  const ctx = new OfflineAudioContext(clip.channels.length, len, clip.sampleRate)
  const buf = ctx.createBuffer(clip.channels.length, len, clip.sampleRate)
  for (const [i, ch] of clip.channels.entries()) buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const chain = createFxChain(ctx, slots, host)
  src.connect(chain.input)
  chain.output.connect(ctx.destination)
  src.start()
  const out = await ctx.startRendering()
  return { ...clip, channels: clip.channels.map((_, i) => out.getChannelData(i)) }
}

/** FX の列のエフェクト。host はテンポを渡す（ディレイの同期） */
export function fxEffect(host: HostInfo): Effect<FxSlot[]> {
  return {
    initial: [],
    isNeutral: isNeutralChain,
    render: (clip, slots) => applyFx(clip, slots, host),
    live: (ctx, slots) => {
      const chain = createFxChain(ctx, slots, host)
      return { input: chain.input, output: chain.output, update: chain.update, dispose: chain.dispose }
    },
  }
}

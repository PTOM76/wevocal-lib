// 鳴らす音の上限（耳とスピーカーを守るリミッター。WeVocalSynth と WeVocal Studio で共通）。再生の出口は ctx.destination ではなく limitedOutput(ctx) につなぐ

/** 上限（dBFS）。null なら上限なし */
let limitDb: number | null = -1
/** AudioContext ごとのリミッター */
const limiters = new WeakMap<BaseAudioContext, DynamicsCompressorNode>()
/** 作ったリミッター（設定を変えたときに全部へ反映するため） */
const all = new Set<WeakRef<DynamicsCompressorNode>>()

/** 上限なしのときは、ほぼ何もしない値にする（閾値 0dB、比 1） */
function apply(n: DynamicsCompressorNode) {
  const t = n.context.currentTime
  n.threshold.setValueAtTime(limitDb ?? 0, t)
  n.ratio.setValueAtTime(limitDb === null ? 1 : 20, t)
}

/** 上限を変える（App が設定から呼ぶ） */
export function setOutputLimit(db: number | null) {
  limitDb = db
  for (const r of all) {
    const n = r.deref()
    if (n) apply(n)
    else all.delete(r)
  }
}

/** この AudioContext の出口（リミッターを通して destination へ） */
export function limitedOutput(ctx: AudioContext): AudioNode {
  let n = limiters.get(ctx)
  if (!n) {
    n = ctx.createDynamicsCompressor()
    n.knee.value = 0
    n.attack.value = 0.001
    n.release.value = 0.1
    apply(n)
    n.connect(ctx.destination)
    limiters.set(ctx, n)
    all.add(new WeakRef(n))
  }
  return n
}

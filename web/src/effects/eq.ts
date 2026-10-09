// トラックのグラフィック EQ の計算（再生と書き出しに掛ける。WeVocalSynth と WeVocal Studio で共通）
import type { Clip } from '../types'
import type { Effect } from './types'

/**
 * トラックのグラフィック EQ。フェーダーと同じく音声は書き換えず、再生と書き出しの両方に常に掛ける。
 * 元に戻す履歴には入れないが、プロジェクトファイルと自動保存には保存する
 */
export interface TrackEq {
  /** 帯の数 */
  bands: EqBands
  /** 帯ごとの dB（低い周波数から順。長さは bands） */
  gains: number[]
  /** オフにすると値を残したまま通さない */
  on: boolean
  /** 帯の値の上限（±dB）。無ければ 12 */
  range?: EqRange
}

export type EqRange = 12 | 24

export type EqBands = 10 | 31

/** 帯の値の上限（±dB）。既定は 12 で、24 に広げられる */
export const eqRange = (eq: TrackEq): EqRange => eq.range ?? 12

/** 上限を変える。狭めたときは、はみ出した値を収める */
export const setEqRange = (eq: TrackEq, range: EqRange): TrackEq => ({ ...eq, range, gains: eq.gains.map((g) => Math.max(-range, Math.min(range, g))) })

/** 帯ごとの中心の周波数（10 帯は 1 オクターブごと、31 帯は 1/3 オクターブごと。ISO の中心周波数） */
const FREQS: Record<EqBands, readonly number[]> = {
  10: [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000],
  31: [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
    10000, 12500, 16000, 20000,
  ],
}

/** 帯の幅（Q）。隣の帯と半分ほど重なる値 */
const Q: Record<EqBands, number> = { 10: 1.41, 31: 4.32 }

export const eqFreqs = (bands: EqBands) => FREQS[bands]

export const flatEq = (bands: EqBands = 10): TrackEq => ({ bands, gains: Array.from({ length: bands }, () => 0), on: true })

export const DEFAULT_EQ: TrackEq = flatEq()

/** 通しても音が変わらない（オフか、全部の帯が 0 dB） */
export const isFlatEq = (eq: TrackEq) => !eq.on || eq.gains.every((g) => g === 0)

/** 帯の数を変える。今の値を周波数（対数）で直線補間して、描いた形を保つ */
export function resizeEq(eq: TrackEq, bands: EqBands): TrackEq {
  if (eq.bands === bands) return eq
  const from = FREQS[eq.bands].map(Math.log2)
  const gains = FREQS[bands].map((f) => {
    const x = Math.log2(f)
    if (x <= from[0]) return eq.gains[0]
    if (x >= from[from.length - 1]) return eq.gains[from.length - 1]
    const i = from.findIndex((v) => v >= x)
    const r = (x - from[i - 1]) / (from[i] - from[i - 1])
    return Math.round((eq.gains[i - 1] + (eq.gains[i] - eq.gains[i - 1]) * r) * 10) / 10
  })
  return { ...eq, bands, gains }
}

/** 保存したものを読む。形が崩れていれば平らにする（古いファイルには無い） */
export function parseEq(v: unknown): TrackEq {
  const e = v as Partial<TrackEq> | undefined
  const bands = e?.bands === 31 ? 31 : 10
  if (!e || !Array.isArray(e.gains) || e.gains.length !== bands) return flatEq(bands)
  const range: EqRange = e.range === 24 ? 24 : 12
  return { bands, gains: e.gains.map((g) => Math.max(-range, Math.min(range, Number(g) || 0))), on: e.on !== false, ...(range === 24 ? { range } : {}) }
}

/** EQ の帯のノードを直列につなぐ。平らな帯は省く。全部平らなら入口と出口は同じノード */
export function buildEqChain(ctx: BaseAudioContext, eq: TrackEq): { input: AudioNode; output: AudioNode; nodes: AudioNode[] } {
  const input = ctx.createGain()
  const nodes: AudioNode[] = [input]
  let last: AudioNode = input
  if (eq.on) {
    for (const [i, f] of FREQS[eq.bands].entries()) {
      if (eq.gains[i] === 0 || f >= ctx.sampleRate / 2) continue
      const b = ctx.createBiquadFilter()
      b.type = 'peaking'
      b.frequency.value = f
      b.Q.value = Q[eq.bands]
      b.gain.value = eq.gains[i]
      last = last.connect(b)
      nodes.push(b)
    }
  }
  return { input, output: last, nodes }
}

/** 音声に EQ を掛ける（書き出し用。再生と同じノードを OfflineAudioContext で組む）。平らなら同じものを返す */
export async function applyEq(clip: Clip, eq: TrackEq): Promise<Clip> {
  if (isFlatEq(eq)) return clip
  const len = clip.channels[0]?.length ?? 0
  if (!len) return clip
  const ctx = new OfflineAudioContext(clip.channels.length, len, clip.sampleRate)
  const buf = ctx.createBuffer(clip.channels.length, len, clip.sampleRate)
  for (const [i, ch] of clip.channels.entries()) buf.copyToChannel(ch as Float32Array<ArrayBuffer>, i)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const chain = buildEqChain(ctx, eq)
  src.connect(chain.input)
  chain.output.connect(ctx.destination)
  src.start()
  const out = await ctx.startRendering()
  return { ...clip, channels: clip.channels.map((_, i) => out.getChannelData(i)) }
}

/**
 * 再生中の EQ のノード。平らなトラックは帯を作らない（入口と出口を直につなぐ）。
 * 一度帯を作ったら、0 dB に戻しても再生が止まるまでは残し、値は gain だけを変える（組み直すと途切れるため）
 */
export interface LiveEq {
  input: GainNode
  output: GainNode
  bands: BiquadFilterNode[]
}

const liveGains = (eq: TrackEq) => (eq.on ? eq.gains : eq.gains.map(() => 0))

function connectBands(n: LiveEq, eq: TrackEq) {
  const ctx = n.input.context
  n.bands = (isFlatEq(eq) ? [] : FREQS[eq.bands]).map((f, i) => {
    const b = ctx.createBiquadFilter()
    b.type = 'peaking'
    b.frequency.value = Math.min(f, ctx.sampleRate / 2 - 1)
    b.Q.value = Q[eq.bands]
    b.gain.value = liveGains(eq)[i]
    return b
  })
  let last: AudioNode = n.input
  for (const b of n.bands) last = last.connect(b)
  last.connect(n.output)
}

export function createLiveEq(ctx: BaseAudioContext, eq: TrackEq): LiveEq {
  const n: LiveEq = { input: ctx.createGain(), output: ctx.createGain(), bands: [] }
  connectBands(n, eq)
  return n
}

/** 再生中に値を変える。帯がまだ無いときと、帯の数が変わったときだけ組み直す */
export function updateLiveEq(n: LiveEq, eq: TrackEq) {
  if (!n.bands.length && isFlatEq(eq)) return
  if (n.bands.length !== eq.bands) {
    n.input.disconnect()
    for (const b of n.bands) b.disconnect()
    connectBands(n, eq)
    return
  }
  const t = n.input.context.currentTime
  for (const [i, g] of liveGains(eq).entries()) n.bands[i].gain.setTargetAtTime(g, t, 0.01)
}

export function disconnectLiveEq(n: LiveEq) {
  n.input.disconnect()
  for (const b of n.bands) b.disconnect()
  n.output.disconnect()
}

/** グラフィック EQ のエフェクト */
export const eqEffect: Effect<TrackEq> = {
  initial: DEFAULT_EQ,
  isNeutral: isFlatEq,
  render: applyEq,
  live: (ctx, eq) => {
    const n = createLiveEq(ctx, eq)
    return { input: n.input, output: n.output, update: (v) => updateLiveEq(n, v), dispose: () => disconnectLiveEq(n) }
  },
}

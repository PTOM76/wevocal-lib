// フェーダー（音量、パン、位相の反転）。書き出しの計算と、再生のノード（WeVocalSynth と WeVocal Studio で共通）
import type { Clip } from '../types'
import type { Effect } from './types'

/**
 * トラックの音量・パン（フェーダー）。音声は書き換えず、再生と書き出しの両方に常に掛ける（適用ボタンは無い）。
 * 元に戻す履歴には入れないが、プロジェクトファイルと自動保存には保存する
 */
export interface TrackFader {
  /** 音量（dB） */
  db: number
  /** パン（-1 = 左 … 0 = 中央 … 1 = 右） */
  pan: number
  /** 位相（極性）を反転する（波形の上下を逆にする。ほかのトラックとの打ち消し合いを直す・確かめるとき） */
  invert?: boolean
}

export const DEFAULT_FADER: TrackFader = { db: 0, pan: 0 }

export const isNeutralFader = (f: TrackFader) => f.db === 0 && f.pan === 0 && !f.invert

/** フェーダーの音量の倍率（位相の反転は負の倍率として掛ける） */
export const faderGain = (f: TrackFader) => 10 ** (f.db / 20) * (f.invert ? -1 : 1)

/**
 * トラックのフェーダー（音量 `db`・パン `pan`）を、クリップ全体に掛けた音声（書き出し用）。
 * 再生（usePlayer の GainNode → StereoPannerNode）と同じ計算。どちらも中立なら元のクリップを返す
 */
export function applyFader(clip: Clip, db: number, pan: number, invert = false): Clip {
  if (db === 0 && pan === 0 && !invert) return clip
  // 位相の反転は負の倍率（再生の usePlayer と同じ）
  const g = 10 ** (db / 20) * (invert ? -1 : 1)
  if (pan === 0) return { sampleRate: clip.sampleRate, channels: clip.channels.map((c) => c.map((v) => v * g)) }
  const [l0, r0] = clip.channels.length >= 2 ? clip.channels : [clip.channels[0], clip.channels[0]]
  const n = l0.length
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  const x = ((pan <= 0 ? pan + 1 : pan) * Math.PI) / 2
  const [cos, sin] = [Math.cos(x), Math.sin(x)]
  for (let i = 0; i < n; i++) {
    const a = l0[i] * g
    const b = r0[i] * g
    // StereoPannerNode（ステレオ入力）と同じ式（panRange の説明を参照）
    if (pan <= 0) {
      l[i] = a + b * cos
      r[i] = b * sin
    } else {
      l[i] = a * cos
      r[i] = b + a * sin
    }
  }
  return { sampleRate: clip.sampleRate, channels: [l, r] }
}

/** パンの処理。モノラルも左右同じ音のステレオにしてから掛ける（適用の panRange・書き出しの applyFader と同じ計算になるように） */
export function makePanner(ctx: BaseAudioContext) {
  const p = ctx.createStereoPanner()
  p.channelCount = 2
  p.channelCountMode = 'explicit'
  p.channelInterpretation = 'speakers'
  return p
}

/**
 * フェーダー（音量・パン）の値を、つないだノードに入れる。再生中に動かしたときは途切れないよう少しだけならし、
 * 再生を始めるとき（`immediate`）はそのまま入れる（出だしの音量がずれないように）
 */
export function setFaderNodes(n: { gain: GainNode; pan: StereoPannerNode }, f: TrackFader, immediate = false) {
  // 位相の反転は負の倍率として掛ける（書き出しの applyFader と同じ）
  if (immediate) {
    n.gain.gain.value = faderGain(f)
    n.pan.pan.value = f.pan
    return
  }
  const t = n.gain.context.currentTime
  n.gain.gain.setTargetAtTime(faderGain(f), t, 0.01)
  n.pan.pan.setTargetAtTime(f.pan, t, 0.01)
}


/** フェーダーのエフェクト（音量 → パン） */
export const faderEffect: Effect<TrackFader> = {
  initial: DEFAULT_FADER,
  isNeutral: isNeutralFader,
  render: (clip, f) => applyFader(clip, f.db, f.pan, f.invert),
  live: (ctx, f) => {
    const n = { gain: ctx.createGain(), pan: makePanner(ctx) }
    n.gain.connect(n.pan)
    // 再生を始めるときはそのまま入れる（出だしの音量がずれないように）
    setFaderNodes(n, f, true)
    return {
      input: n.gain,
      output: n.pan,
      update: (v) => setFaderNodes(n, v),
      dispose: () => {
        n.gain.disconnect()
        n.pan.disconnect()
      },
    }
  },
}

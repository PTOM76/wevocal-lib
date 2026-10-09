// エフェクトの型（WeVocalSynth と WeVocal Studio で共通）。トラックに掛けるもの（EQ、フェーダー）は、どれもこの形にする
import type { Clip } from '../types'

/** 再生中のエフェクトのノード（input から入れて output から出す） */
export interface LiveEffect<V> {
  input: AudioNode
  output: AudioNode
  /** 再生中に値を変える（途切れないよう少しだけならす） */
  update: (v: V) => void
  dispose: () => void
}

/** トラックに掛けるエフェクト。音声は書き換えず、再生と書き出しの両方に掛ける */
export interface Effect<V> {
  /** 既定の値（何もしない） */
  initial: V
  /** 何もしない値か（書き出しで飛ばす、トラックに印を出すかに使う） */
  isNeutral: (v: V) => boolean
  /** 音声に掛ける（書き出しと、音声に書き込む適用） */
  render: (clip: Clip, v: V) => Clip | Promise<Clip>
  /** 再生のノードを作る */
  live: (ctx: BaseAudioContext, v: V) => LiveEffect<V>
}

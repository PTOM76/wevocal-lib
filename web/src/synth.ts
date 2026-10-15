// 音を 0 から作る（声の母音、楽器の波形。WeVocalSynth と WeVocal Studio で共通）
import type { Clip } from './types'
import { midiToHz } from './notes'

/**
 * 音を0から作る（新しいトラック用）。ブラウザの OfflineAudioContext で合成する。
 * - 楽器: 基本の波形に、音符ごとの音量の立ち上がり・減衰（エンベロープ）を付ける
 * - 声: 倍音の多い波形（声帯の音の代わり）に、母音ごとの響き（フォルマント F1〜F3）を強めるフィルターを重ねる
 * 歌声合成ほど自然ではないが、ピッチ・長さ・フォルマントの加工の素材として使う
 */

export type Vowel = 'a' | 'i' | 'u' | 'e' | 'o'
export type Timbre = { kind: 'voice'; vowel: Vowel } | { kind: 'wave'; wave: 'sawtooth' | 'square' | 'triangle' | 'sine' }

export interface SynthNote {
  /** MIDI ノート番号（C4 = 60） */
  note: number
  /** 始まり・終わり（秒） */
  start: number
  end: number
}

export interface SynthOptions {
  timbre: Timbre
  /** ビブラート（深さは半音、速さは Hz）。null なら付けない */
  vibrato: { depth: number; rate: number } | null
  /** 声のフォルマント（響き）をずらす量（半音）。上げると子どもっぽく、下げると太い声になる。楽器では使わない */
  formantShift?: number
  /** 仕上がりのピーク（dB）。既定は PEAK_DB */
  peakDb?: number
  sampleRate?: number
}

/** 母音ごとのフォルマント（中心周波数 Hz・帯域幅 Hz・強さ）。日本語の母音の目安（女声寄り） */
const FORMANTS: Record<Vowel, [number, number, number][]> = {
  a: [[800, 90, 1], [1250, 110, 0.6], [2600, 160, 0.25]],
  i: [[300, 60, 1], [2300, 120, 0.45], [3000, 180, 0.3]],
  u: [[350, 70, 1], [1300, 110, 0.4], [2500, 160, 0.2]],
  e: [[500, 80, 1], [1900, 120, 0.5], [2700, 170, 0.25]],
  o: [[500, 80, 1], [850, 100, 0.6], [2500, 160, 0.2]],
}

/** 音の立ち上がり・離したあとの減衰（秒） */
const ATTACK_SEC = 0.02
const RELEASE_SEC = 0.06
/** 音符が変わるときに、音の高さをならす時間（秒） */
const GLIDE_SEC = 0.015
/** 仕上がりのピークの既定値（dB） */
export const PEAK_DB = -3

/** `notes` を合成した音（モノラル）。長さは最後の音符の終わり＋減衰まで */
export async function synthesize(notes: SynthNote[], o: SynthOptions): Promise<Clip> {
  const sr = o.sampleRate ?? 48000
  const sorted = [...notes].filter((n) => n.end > n.start).sort((a, b) => a.start - b.start)
  if (!sorted.length) throw new Error('no notes')
  const dur = Math.max(...sorted.map((n) => n.end)) + RELEASE_SEC + 0.05
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * sr), sr)

  const osc = ctx.createOscillator()
  osc.type = o.timbre.kind === 'voice' ? 'sawtooth' : o.timbre.wave
  // 音の高さ: 音符の始まりで次の高さへなめらかに移る
  osc.frequency.setValueAtTime(midiToHz(sorted[0].note), 0)
  for (const n of sorted) osc.frequency.setTargetAtTime(midiToHz(n.note), n.start, GLIDE_SEC / 3)

  // ビブラート: 低い周波数の揺れを detune（セント）に足す
  if (o.vibrato && o.vibrato.depth > 0) {
    const lfo = ctx.createOscillator()
    lfo.frequency.value = o.vibrato.rate
    const depth = ctx.createGain()
    depth.gain.value = o.vibrato.depth * 100
    lfo.connect(depth).connect(osc.detune)
    lfo.start()
  }

  // 音量のエンベロープ（音符の間は無音）
  const env = ctx.createGain()
  env.gain.setValueAtTime(0, 0)
  for (const n of sorted) {
    env.gain.setTargetAtTime(1, n.start, ATTACK_SEC / 3)
    env.gain.setTargetAtTime(0, n.end, RELEASE_SEC / 3)
  }

  if (o.timbre.kind === 'voice') {
    // フォルマント: 帯域通過フィルターを並べて足す。ずらすときは周波数と帯域幅を同じ比率で動かす（Q は変わらない）
    const ratio = 2 ** ((o.formantShift ?? 0) / 12)
    const sum = ctx.createGain()
    for (const [f, bw, amp] of FORMANTS[o.timbre.vowel]) {
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = Math.min(sr / 2 - 100, f * ratio)
      bp.Q.value = f / bw
      const g = ctx.createGain()
      g.gain.value = amp
      osc.connect(bp).connect(g).connect(sum)
    }
    sum.connect(env)
  } else {
    // 楽器: 耳に痛い高い倍音だけ少し落とす
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 9000
    osc.connect(lp).connect(env)
  }
  env.connect(ctx.destination)
  osc.start(0)

  const out = (await ctx.startRendering()).getChannelData(0)
  // ピークを指定の大きさ（既定は PEAK_DB）にそろえる
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0) {
    const g = 10 ** ((o.peakDb ?? PEAK_DB) / 20) / peak
    for (let i = 0; i < out.length; i++) out[i] *= g
  }
  return { sampleRate: sr, channels: [out] }
}

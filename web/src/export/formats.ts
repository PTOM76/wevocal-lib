// 書き出し形式ごとの定数と対応チェック。
// エンコーダ本体（mp3.ts / opus.ts / aac.ts / flac.ts）は書き出すときだけ読み込むため、画面から参照するものはここに分ける

/** MP3 が扱えるサンプルレート（MPEG-1 Layer III） */
export const MP3_SAMPLE_RATES = [32000, 44100, 48000]

/** Opus は 48kHz で扱う（Ogg Opus の granule も 48kHz 換算） */
export const OPUS_SAMPLE_RATE = 48000

/** AAC で書き出すサンプルレート（WebCodecs のエンコーダーが受け付けるもの） */
export const AAC_SAMPLE_RATES = [44100, 48000]

/** WebCodecs の AAC-LC */
export const AAC_CODEC = 'mp4a.40.2'

/** 圧縮して書き出す形式（ビットレートを選ぶもの） */
export type LossyFormat = 'mp3' | 'opus' | 'aac'

/** 形式ごとに選べるビットレート（kbps） */
export const BITRATES: Record<LossyFormat, number[]> = {
  mp3: [32, 48, 64, 96, 128, 160, 192, 256, 320],
  opus: [24, 32, 48, 64, 96, 128, 160, 192, 256],
  aac: [64, 96, 128, 160, 192, 256, 320],
}

export const isLossy = (f: string): f is LossyFormat => f in BITRATES

/** 選べる中で、長さ `seconds` の音声が `bytes` 以下になる一番高いビットレート。どれも超えるなら一番低いもの */
export function kbpsForSize(format: LossyFormat, seconds: number, bytes: number): number {
  // 入れ物の分（ヘッダーなど）を 3% 見込む
  const limit = (bytes * 8 * 0.97) / Math.max(seconds, 0.001) / 1000
  const list = BITRATES[format]
  return [...list].reverse().find((k) => k <= limit) ?? list[0]
}

async function supported(config: AudioEncoderConfig): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false
  try {
    return !!(await AudioEncoder.isConfigSupported(config)).supported
  } catch {
    return false
  }
}

/** このブラウザが WebCodecs で Opus を書き出せるか */
export function canEncodeOpus(channels: number): Promise<boolean> {
  return supported({ codec: 'opus', sampleRate: OPUS_SAMPLE_RATE, numberOfChannels: channels, bitrate: 128000 })
}

/** このブラウザが WebCodecs で AAC を書き出せるか */
export function canEncodeAac(channels: number): Promise<boolean> {
  return supported({ codec: AAC_CODEC, sampleRate: 48000, numberOfChannels: channels, bitrate: 128000 })
}

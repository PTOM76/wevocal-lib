// 書き出し形式ごとの定数と対応チェック。
// エンコーダ本体（mp3.ts / opus.ts）は書き出すときだけ読み込むため、画面から参照するものはここに分ける

/** MP3 が扱えるサンプルレート（MPEG-1 Layer III） */
export const MP3_SAMPLE_RATES = [32000, 44100, 48000]

/** Opus は 48kHz で扱う（Ogg Opus の granule も 48kHz 換算） */
export const OPUS_SAMPLE_RATE = 48000

/** このブラウザが WebCodecs で Opus を書き出せるか */
export async function canEncodeOpus(channels: number): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false
  try {
    const r = await AudioEncoder.isConfigSupported({
      codec: 'opus',
      sampleRate: OPUS_SAMPLE_RATE,
      numberOfChannels: channels,
      bitrate: 128000,
    })
    return !!r.supported
  } catch {
    return false
  }
}

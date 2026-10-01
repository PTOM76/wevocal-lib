/** メモリ上のプレーナー形式 PCM 音声。全チャンネルは同じ長さ */
export interface Clip {
  sampleRate: number
  channels: Float32Array[]
}

/** 時間範囲（秒） */
export interface Range {
  start: number
  end: number
}

/// <reference lib="webworker" />
import { Mp3Encoder } from '@breezystack/lamejs'

/** 1回に渡すサンプル数（MP3 のフレーム 1152 の倍数） */
const CHUNK = 1152 * 20
/** 進捗を送る間隔（区切りの数） */
const PROGRESS_EVERY = 16

export interface Mp3Request {
  pcm: Int16Array[]
  sampleRate: number
  kbps: number
}

export type Mp3Message = { type: 'progress'; value: number } | { type: 'done'; parts: Uint8Array[] }

/** MP3 のエンコードを画面のスレッドから外して行う（処理を譲らずに一気にできるので速い） */
self.onmessage = (e: MessageEvent<Mp3Request>) => {
  const { pcm, sampleRate, kbps } = e.data
  const encoder = new Mp3Encoder(pcm.length, sampleRate, kbps)
  const parts: Uint8Array[] = []
  const len = pcm[0].length
  for (let i = 0, n = 0; i < len; i += CHUNK, n++) {
    const out = encoder.encodeBuffer(pcm[0].subarray(i, i + CHUNK), pcm[1]?.subarray(i, i + CHUNK))
    if (out.length) parts.push(out.slice())
    if (n % PROGRESS_EVERY === 0) self.postMessage({ type: 'progress', value: i / len } satisfies Mp3Message)
  }
  const tail = encoder.flush()
  if (tail.length) parts.push(tail.slice())
  self.postMessage({ type: 'done', parts } satisfies Mp3Message, parts.map((p) => p.buffer))
}

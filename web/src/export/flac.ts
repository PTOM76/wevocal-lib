import type { Clip } from '../types'
import type { FlacMessage, FlacRequest } from './flacWorker'

/** FLAC にエンコードする（ロスレス）。エンコーダーは自前で、Worker の中で動かす */
export function encodeFlac(clip: Clip, bits: 16 | 24, onProgress?: (p: number) => void): Promise<Blob> {
  const max = 2 ** (bits - 1) - 1
  const pcm = clip.channels.map((c) => {
    const out = new Int32Array(c.length)
    for (let i = 0; i < c.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, c[i])) * max)
    return out
  })
  const worker = new Worker(new URL('./flacWorker.ts', import.meta.url), { type: 'module' })
  return new Promise<Blob>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<FlacMessage>) => {
      if (e.data.type === 'progress') return onProgress?.(e.data.value)
      onProgress?.(1)
      worker.terminate()
      resolve(new Blob([e.data.data as BlobPart], { type: 'audio/flac' }))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message))
    }
    worker.postMessage({ pcm, sampleRate: clip.sampleRate, bits } satisfies FlacRequest, pcm.map((c) => c.buffer))
  })
}

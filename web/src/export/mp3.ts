import type { Clip } from '../types'
import { toInt16 } from './prepare'
import type { Mp3Message, Mp3Request } from './mp3Worker'

/**
 * MP3 にエンコードする。エンコーダ（lamejs、LGPL-3.0）は Worker の中で使うので、
 * MP3 を書き出すときだけ読み込まれ、初回表示を重くしない。画面も固まらない。
 */
export function encodeMp3(clip: Clip, kbps: number, onProgress?: (p: number) => void): Promise<Blob> {
  const pcm = clip.channels.slice(0, 2).map(toInt16)
  const worker = new Worker(new URL('./mp3Worker.ts', import.meta.url), { type: 'module' })
  return new Promise<Blob>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<Mp3Message>) => {
      if (e.data.type === 'progress') return onProgress?.(e.data.value)
      onProgress?.(1)
      worker.terminate()
      resolve(new Blob(e.data.parts as BlobPart[], { type: 'audio/mpeg' }))
    }
    worker.onerror = (e) => {
      worker.terminate()
      reject(new Error(e.message))
    }
    worker.postMessage({ pcm, sampleRate: clip.sampleRate, kbps } satisfies Mp3Request, pcm.map((c) => c.buffer))
  })
}

import type { Clip } from './types'

export type WavFormat = 'pcm16' | 'pcm24' | 'float32'

/** クリップをインターリーブ形式の RIFF/WAVE ファイルにエンコードする */
export function encodeWav(clip: Clip, format: WavFormat = 'pcm16'): Blob {
  const ch = clip.channels.length
  const frames = clip.channels[0]?.length ?? 0
  const bytes = format === 'pcm16' ? 2 : format === 'pcm24' ? 3 : 4
  const dataSize = frames * ch * bytes
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }

  str(0, 'RIFF')
  v.setUint32(4, 36 + dataSize, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, format === 'float32' ? 3 : 1, true)
  v.setUint16(22, ch, true)
  v.setUint32(24, clip.sampleRate, true)
  v.setUint32(28, clip.sampleRate * ch * bytes, true)
  v.setUint16(32, ch * bytes, true)
  v.setUint16(34, bytes * 8, true)
  str(36, 'data')
  v.setUint32(40, dataSize, true)

  let o = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const s = clip.channels[c][i]
      if (format === 'float32') {
        v.setFloat32(o, s, true)
      } else {
        const x = Math.max(-1, Math.min(1, s))
        if (format === 'pcm16') {
          v.setInt16(o, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), true)
        } else {
          const n = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff)
          v.setUint8(o, n & 0xff)
          v.setUint8(o + 1, (n >> 8) & 0xff)
          v.setUint8(o + 2, (n >> 16) & 0xff)
        }
      }
      o += bytes
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** クリップを WAV にしてブラウザからダウンロードさせる */
export function downloadWav(clip: Clip, fileName: string, format: WavFormat) {
  downloadBlob(encodeWav(clip, format), fileName)
}

/** Blob をファイルとしてダウンロードさせる */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

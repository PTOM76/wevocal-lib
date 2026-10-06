import type { Clip } from './types'

/**
 * WeVocalSynth のプロジェクトファイル（.wvsp）の読み書き。形式は WeVocalSynth の docs/PROJECT_FORMAT.md。次の並び（圧縮しない）:
 *   "WVSP"（4バイト）| ヘッダ JSON の長さ（u32 LE）| ヘッダ JSON（UTF-8）| 音声データ
 * 音声データはトラックごとに原音・加工後の順に、各クリップのチャンネルを順に並べた f32 LE。
 * 版 1 はトラックが1本だけだった（原音・加工後の2クリップ）。読み込むときは1トラックとして扱う。
 * 以前は gzip で圧縮していた。圧縮された古いファイルも読み込める。
 * ヘッダのうちアプリに固有の中身（加工のパラメータ、テンポ、マーカー、トラックの状態）は、そのまま受け渡す
 */
export const WVSP_EXT = '.wvsp'
const MAGIC = 'WVSP'
export const WVSP_VERSION = 3

export const isWvspFile = (file: File) => file.name.toLowerCase().endsWith(WVSP_EXT)

/** 読み込めないときのエラー。`invalid` は形式が違う、`unsupported` は対応していない版 */
export class WvspError extends Error {
  readonly code: 'invalid' | 'unsupported'
  constructor(code: 'invalid' | 'unsupported') {
    super(`wvsp: ${code}`)
    this.code = code
  }
}

/** 1 トラック。`info` はヘッダのトラックの情報（名前のほか、アプリに固有の状態） */
export interface WvspTrack<I extends { name: string } = { name: string }> {
  info: I
  original: Clip
  edited: Clip
}

/** ヘッダのうち、トラックと音声の並び以外（アプリに固有の項目もここに入る） */
export interface WvspHeader {
  fileName: string
  /** 編集していたトラックの位置 */
  active?: number
  [key: string]: unknown
}

/** `same`: 中身を書かず、直前のクリップ（そのトラックの原音）と同じ。版 3 から */
type ClipInfo = { sampleRate: number; channels: number; length: number; same?: boolean }

/**
 * f32 はリトルエンディアンで保存する。ブラウザが動く環境（x86 / ARM）はほぼリトルエンディアンなので、
 * その場合はメモリのバイト列をそのまま使う（1サンプルずつ変換すると3分の音声で数秒かかり画面が固まる）
 */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

function toLittleEndian(ch: Float32Array): ArrayBuffer {
  if (LITTLE_ENDIAN) return ch.slice().buffer
  const v = new DataView(new ArrayBuffer(ch.length * 4))
  for (let i = 0; i < ch.length; i++) v.setFloat32(i * 4, ch[i], true)
  return v.buffer
}

/** 1 チャンネル分のバイト列（f32 LE）を Float32Array にする */
function fromLittleEndian(buf: ArrayBuffer): Float32Array {
  if (LITTLE_ENDIAN) return new Float32Array(buf)
  const v = new DataView(buf)
  const ch = new Float32Array(buf.byteLength / 4)
  for (let i = 0; i < ch.length; i++) ch[i] = v.getFloat32(i * 4, true)
  return ch
}

/** .wvsp の Blob にする。加工後が原音と同じ（同じオブジェクト）なら中身を書かない */
export function writeWvsp<I extends { name: string }>(header: WvspHeader, tracks: WvspTrack<I>[]): Blob {
  const clips = tracks.flatMap((t) => [
    { clip: t.original, same: false },
    { clip: t.edited, same: t.edited === t.original },
  ])
  const full = {
    ...header,
    version: WVSP_VERSION,
    tracks: tracks.map((t) => t.info),
    clips: clips.map(({ clip: c, same }): ClipInfo => ({ sampleRate: c.sampleRate, channels: c.channels.length, length: c.channels[0].length, ...(same ? { same } : {}) })),
  }
  const json = new TextEncoder().encode(JSON.stringify(full))
  const lead = new Uint8Array(8)
  lead.set(new TextEncoder().encode(MAGIC), 0)
  new DataView(lead.buffer).setUint32(4, json.length, true)
  const pcm = clips.flatMap(({ clip, same }) => (same ? [] : clip.channels.map(toLittleEndian)))
  return new Blob([lead, json, ...pcm], { type: 'application/octet-stream' })
}

/**
 * .wvsp ファイルを読み込む。形式が違えば WvspError。
 * チャンネルごとにファイルの必要な部分だけを読む（全体を読んでから切り出すと、一時的にファイルの 2 倍のメモリを使った）
 */
export async function readWvsp<I extends { name: string } = { name: string }>(file: Blob, onProgress?: (p: number) => void): Promise<{ header: WvspHeader; tracks: WvspTrack<I>[]; active: number }> {
  // 先頭が gzip の印（1f 8b）なら、以前の圧縮形式として展開する（全体を読む）
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const gzipped = head[0] === 0x1f && head[1] === 0x8b
  const whole = gzipped
    ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer().catch(() => {
        throw new WvspError('invalid')
      })
    : null
  const source: Blob = whole ? new Blob([whole]) : file
  const lead = whole ? new Uint8Array(whole, 0, Math.min(8, whole.byteLength)) : head
  if (lead.byteLength < 8 || new TextDecoder().decode(lead.subarray(0, 4)) !== MAGIC) throw new WvspError('invalid')
  const jsonLen = new DataView(lead.buffer, lead.byteOffset, 8).getUint32(4, true)
  const raw = JSON.parse(new TextDecoder().decode(await source.slice(8, 8 + jsonLen).arrayBuffer())) as WvspHeader & { version: number; tracks?: I[]; clips: ClipInfo[] }
  const infos: I[] | null = raw.version === 1 ? [{ name: raw.fileName } as I] : raw.version === 2 || raw.version === 3 ? (raw.tracks ?? []) : null
  if (!infos || raw.clips.length !== infos.length * 2 || infos.length === 0) throw new WvspError('unsupported')

  const total = raw.clips.reduce((s, c) => s + (c.same ? 0 : c.channels * c.length * 4), 0) || 1
  let offset = 8 + jsonLen
  let read = 0
  const clips: Clip[] = []
  for (const info of raw.clips) {
    if (info.same && clips.length) {
      clips.push(clips[clips.length - 1])
      continue
    }
    const channels: Float32Array[] = []
    for (let c = 0; c < info.channels; c++) {
      const bytes = info.length * 4
      const buf = await source.slice(offset, offset + bytes).arrayBuffer()
      if (buf.byteLength !== bytes) throw new WvspError('invalid')
      channels.push(fromLittleEndian(buf))
      offset += bytes
      read += bytes
      onProgress?.(read / total)
    }
    clips.push({ sampleRate: info.sampleRate, channels })
  }
  const { version: _version, tracks: _tracks, clips: _clips, ...header } = raw
  const tracks = infos.map((info, i) => ({ info, original: clips[i * 2], edited: clips[i * 2 + 1] }))
  return { header, tracks, active: Math.min(raw.active ?? 0, tracks.length - 1) }
}

// AAC のフレームを M4A（MP4 の音声だけのファイル）にまとめる。moov を先に置く（読み込みながら再生できる）

/** AAC の 1 フレームのサンプル数 */
export const AAC_FRAME = 1024

const FREQ_INDEX = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]

/** エンコーダーが知らせてこなかったときの AudioSpecificConfig（AAC-LC） */
export function audioSpecificConfig(rate: number, channels: number): Uint8Array {
  const f = Math.max(0, FREQ_INDEX.indexOf(rate))
  return new Uint8Array([(2 << 3) | (f >> 1), ((f & 1) << 7) | (channels << 3)])
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const u16 = (v: number) => [(v >>> 8) & 0xff, v & 0xff]
const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
const zeros = (n: number) => new Array<number>(n).fill(0)

function box(type: string, ...body: (number[] | Uint8Array)[]): number[] {
  const content = body.flatMap((b) => [...b])
  return [...u32(content.length + 8), ...ascii(type), ...content]
}
/** version と flags の付いた箱 */
const full = (type: string, flags: number, ...body: (number[] | Uint8Array)[]) => box(type, u32(flags), ...body)

/** ES_Descriptor の中の記述子（長さは 1 バイト） */
const desc = (tag: number, ...body: number[][]) => {
  const content = body.flat()
  return [tag, content.length, ...content]
}

const MATRIX = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)]

function moov(o: { rate: number; channels: number; samples: number; sizes: number[]; config: Uint8Array; kbps: number; offset: number }) {
  const { rate, samples, sizes } = o
  const esds = full(
    'esds',
    0,
    desc(
      3,
      [...u16(0), 0],
      desc(4, [0x40, 0x15, 0, 0, 0, ...u32(o.kbps * 1000), ...u32(o.kbps * 1000)], desc(5, [...o.config])),
      desc(6, [2]),
    ),
  )
  const mp4a = box('mp4a', zeros(6), u16(1), zeros(8), u16(o.channels), u16(16), zeros(4), u32(rate * 0x10000), esds)
  const stbl = box(
    'stbl',
    full('stsd', 0, u32(1), mp4a),
    full('stts', 0, u32(1), u32(sizes.length), u32(AAC_FRAME)),
    full('stsc', 0, u32(1), u32(1), u32(sizes.length), u32(1)),
    full('stsz', 0, u32(0), u32(sizes.length), sizes.flatMap(u32)),
    full('stco', 0, u32(1), u32(o.offset)),
  )
  const minf = box('minf', full('smhd', 0, zeros(4)), box('dinf', full('dref', 0, u32(1), full('url ', 1))), stbl)
  const mdia = box(
    'mdia',
    full('mdhd', 0, zeros(8), u32(rate), u32(samples), u16(0x55c4), zeros(2)),
    full('hdlr', 0, zeros(4), ascii('soun'), zeros(12), ascii('SoundHandler'), [0]),
    minf,
  )
  const tkhd = full('tkhd', 3, zeros(8), u32(1), zeros(4), u32(samples), zeros(8), zeros(4), u16(0x0100), zeros(2), MATRIX, zeros(8))
  const mvhd = full('mvhd', 0, zeros(8), u32(rate), u32(samples), u32(0x10000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2))
  return box('moov', mvhd, box('trak', tkhd, mdia))
}

/** AAC のフレームを M4A にする */
export function muxM4a(frames: Uint8Array[], o: { rate: number; channels: number; samples: number; config: Uint8Array; kbps: number }): Blob {
  const ftyp = box('ftyp', ascii('M4A '), u32(0), ascii('M4A '), ascii('isom'), ascii('mp42'))
  const sizes = frames.map((f) => f.byteLength)
  // moov の大きさは offset の値によらないので、一度作って測ってから作り直す
  const probe = moov({ ...o, sizes, offset: 0 })
  const data = sizes.reduce((a, b) => a + b, 0)
  const head = new Uint8Array([...ftyp, ...moov({ ...o, sizes, offset: ftyp.length + probe.length + 8 }), ...u32(data + 8), ...ascii('mdat')])
  return new Blob([head, ...(frames as BlobPart[])], { type: 'audio/mp4' })
}

/**
 * Ogg コンテナ（Opus 用）の最小限の書き出し。RFC 3533（Ogg）と RFC 7845（Ogg Opus）に従い、
 * OpusHead・OpusTags・音声パケットをページにまとめる。
 */

// Ogg のページ用 CRC32（多項式 0x04c11db7、反転なし）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
    t[i] = r >>> 0
  }
  return t
})()

function crc32(data: Uint8Array) {
  let crc = 0
  for (const b of data) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0
  return crc
}

/** Ogg のページを順に作る */
export class OggWriter {
  private pages: Uint8Array[] = []
  private seq = 0
  private readonly serial = (Math.random() * 0xffffffff) >>> 0

  /**
   * パケットの並びを1ページにする。`granule` はこのページの終わりまでの累計サンプル数（48kHz 換算）。
   * `flags`: 0x02 = 最初のページ、0x04 = 最後のページ
   */
  addPage(packets: Uint8Array[], granule: bigint, flags = 0) {
    // 各パケットの長さを 255 ずつの区切り（lacing）で表す
    const lacing: number[] = []
    for (const p of packets) {
      let n = p.length
      while (n >= 255) {
        lacing.push(255)
        n -= 255
      }
      lacing.push(n)
    }
    const bodyLen = packets.reduce((s, p) => s + p.length, 0)
    const page = new Uint8Array(27 + lacing.length + bodyLen)
    const v = new DataView(page.buffer)
    page.set([0x4f, 0x67, 0x67, 0x53], 0) // "OggS"
    page[4] = 0
    page[5] = flags
    v.setBigUint64(6, granule, true)
    v.setUint32(14, this.serial, true)
    v.setUint32(18, this.seq++, true)
    page[26] = lacing.length
    page.set(lacing, 27)
    let o = 27 + lacing.length
    for (const p of packets) {
      page.set(p, o)
      o += p.length
    }
    v.setUint32(22, crc32(page), true)
    this.pages.push(page)
  }

  toBlob(type: string) {
    return new Blob(this.pages as BlobPart[], { type })
  }
}

/** OpusHead（RFC 7845 5.1）。`preSkip` はエンコーダの遅延（48kHz のサンプル数） */
export function opusHead(channels: number, inputRate: number, preSkip: number) {
  const b = new Uint8Array(19)
  const v = new DataView(b.buffer)
  b.set(new TextEncoder().encode('OpusHead'), 0)
  b[8] = 1
  b[9] = channels
  v.setUint16(10, preSkip, true)
  v.setUint32(12, inputRate, true)
  v.setInt16(16, 0, true)
  b[18] = 0 // チャンネル配置 0（モノラル / ステレオ）
  return b
}

/** OpusTags（RFC 7845 5.2）。タグは入れず、エンコーダ名だけを書く */
export function opusTags(vendor: string) {
  const enc = new TextEncoder().encode(vendor)
  const b = new Uint8Array(8 + 4 + enc.length + 4)
  const v = new DataView(b.buffer)
  b.set(new TextEncoder().encode('OpusTags'), 0)
  v.setUint32(8, enc.length, true)
  b.set(enc, 12)
  v.setUint32(12 + enc.length, 0, true)
  return b
}

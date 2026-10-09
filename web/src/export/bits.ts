// ビット単位で書き込むバッファ（FLAC のエンコーダーで使う）

/** 上位のビットから順に書き込む。足りなくなったら広げる */
export class BitWriter {
  private buf = new Uint8Array(1 << 16)
  private pos = 0
  private acc = 0
  private n = 0

  /** `value` の下位 `bits` ビット（32 まで）を書く */
  write(value: number, bits: number) {
    if (bits > 24) {
      this.write(Math.floor(value / 0x1000000) & ((1 << (bits - 24)) - 1), bits - 24)
      bits = 24
    }
    this.acc = ((this.acc << bits) | (value & ((1 << bits) - 1))) >>> 0
    this.n += bits
    while (this.n >= 8) {
      this.n -= 8
      this.push((this.acc >>> this.n) & 0xff)
    }
    this.acc &= (1 << this.n) - 1
  }

  /** 0 を `q` 個並べてから 1 を書く（Rice 符号の商） */
  unary(q: number) {
    while (q >= 24) {
      this.write(0, 24)
      q -= 24
    }
    this.write(1, q + 1)
  }

  /** バイトの区切りまで 0 で埋める */
  align() {
    if (this.n) this.write(0, 8 - this.n)
  }

  get byteLength() {
    return this.pos
  }

  bytes(start = 0, end = this.pos): Uint8Array {
    return this.buf.subarray(start, end)
  }

  private push(b: number) {
    if (this.pos === this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2)
      next.set(this.buf)
      this.buf = next
    }
    this.buf[this.pos++] = b
  }
}

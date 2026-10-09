/// <reference lib="webworker" />
import { BitWriter } from './bits'

/** 1つのフレームのサンプル数 */
const BLOCK = 4096
/** Rice のパーティションの段数の上限 */
const MAX_PARTITION = 6
/** 進捗を送る間隔（フレームの数） */
const PROGRESS_EVERY = 32

export interface FlacRequest {
  /** チャンネルごとの整数のサンプル（`bits` ビットの範囲） */
  pcm: Int32Array[]
  sampleRate: number
  bits: 16 | 24
}

export type FlacMessage = { type: 'progress'; value: number } | { type: 'done'; data: Uint8Array }

/** FLAC のエンコードを画面のスレッドから外して行う（固定の予測と Rice 符号。左右は差分の組み合わせも試す） */
self.onmessage = (e: MessageEvent<FlacRequest>) => {
  const { pcm, sampleRate, bits } = e.data
  const len = pcm[0].length
  const w = new BitWriter()
  writeStreamInfo(w, sampleRate, pcm.length, bits, len)
  for (let start = 0, frame = 0; start < len; start += BLOCK, frame++) {
    writeFrame(w, pcm.map((c) => c.subarray(start, Math.min(len, start + BLOCK))), bits, frame)
    if (frame % PROGRESS_EVERY === 0) self.postMessage({ type: 'progress', value: start / len } satisfies FlacMessage)
  }
  const data = w.bytes().slice()
  self.postMessage({ type: 'done', data } satisfies FlacMessage, [data.buffer])
}

function writeStreamInfo(w: BitWriter, rate: number, channels: number, bits: number, total: number) {
  for (const c of 'fLaC') w.write(c.charCodeAt(0), 8)
  w.write(0x80, 8) // 最後のメタデータ、種類 0（STREAMINFO）
  w.write(34, 24)
  w.write(BLOCK, 16)
  w.write(BLOCK, 16)
  w.write(0, 24) // フレームの大きさの最小と最大（不明）
  w.write(0, 24)
  w.write(rate, 20)
  w.write(channels - 1, 3)
  w.write(bits - 1, 5)
  w.write(total, 36)
  for (let i = 0; i < 16; i++) w.write(0, 8) // MD5（不明）
}

/** 左右の組み合わせ（チャンネルの割り当ての番号、使う信号、それぞれのビット数の増え方） */
type Stereo = { code: number; pick: (l: Int32Array, r: Int32Array, s: Int32Array, m: Int32Array) => [Int32Array, Int32Array]; extra: [number, number] }
const STEREO: Stereo[] = [
  { code: 1, pick: (l, r) => [l, r], extra: [0, 0] },
  { code: 8, pick: (l, _r, s) => [l, s], extra: [0, 1] },
  { code: 9, pick: (_l, r, s) => [s, r], extra: [1, 0] },
  { code: 10, pick: (_l, _r, s, m) => [m, s], extra: [0, 1] },
]

function writeFrame(w: BitWriter, ch: Int32Array[], bits: number, frame: number) {
  const n = ch[0].length
  let assign = ch.length - 1
  let signals = ch
  let extra = ch.map(() => 0)
  let plans = ch.map((c) => plan(c, bits))
  if (ch.length === 2) {
    const [l, r] = ch
    const s = new Int32Array(n)
    const m = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      s[i] = l[i] - r[i]
      m[i] = (l[i] + r[i]) >> 1
    }
    const cache = new Map<Int32Array, Plan>([[l, plans[0]], [r, plans[1]]])
    const get = (x: Int32Array, b: number) => cache.get(x) ?? cache.set(x, plan(x, b)).get(x)!
    let best = Infinity
    for (const st of STEREO) {
      const [a, b] = st.pick(l, r, s, m)
      const pa = get(a, bits + st.extra[0])
      const pb = get(b, bits + st.extra[1])
      if (pa.cost + pb.cost < best) {
        best = pa.cost + pb.cost
        assign = st.code === 1 ? 1 : st.code
        signals = [a, b]
        extra = st.extra
        plans = [pa, pb]
      }
    }
  }

  const start = w.byteLength
  w.write(0xfff8, 16) // 同期の印、固定のブロックの大きさ
  w.write(7, 4) // ブロックの大きさは後ろの 16 ビット
  w.write(0, 4) // サンプルレートは STREAMINFO のまま
  w.write(assign, 4)
  w.write(0, 3) // ビット数は STREAMINFO のまま
  w.write(0, 1)
  writeUtf8(w, frame)
  w.write(n - 1, 16)
  w.write(crc8(w.bytes(start)), 8)
  signals.forEach((x, i) => writeSubframe(w, x, bits + extra[i], plans[i]))
  w.align()
  w.write(crc16(w.bytes(start)), 16)
}

/** フレームの番号を UTF-8 と同じ形で書く */
function writeUtf8(w: BitWriter, v: number) {
  if (v < 0x80) return w.write(v, 8)
  const bytes: number[] = []
  let lead = 0xc0
  let room = 0x20
  while (v >= room) {
    bytes.unshift(0x80 | (v & 0x3f))
    v >>>= 6
    lead = 0x80 | (lead >> 1)
    room >>= 1
  }
  w.write(lead | v, 8)
  for (const b of bytes) w.write(b, 8)
}

/** サブフレームの書き方（定数、そのまま、固定の予測） */
interface Plan {
  kind: 'constant' | 'verbatim' | 'fixed'
  order: number
  residual: Int32Array
  partition: number
  params: number[]
  cost: number
}

function plan(x: Int32Array, bps: number): Plan {
  const n = x.length
  const verbatim: Plan = { kind: 'verbatim', order: 0, residual: x, partition: 0, params: [], cost: n * bps }
  if (x.every((v) => v === x[0])) return { ...verbatim, kind: 'constant', cost: bps }
  // 残差の絶対値の和が一番小さい次数を選ぶ
  let order = 0
  let bestSum = Infinity
  for (let o = 0; o <= 4 && o < n; o++) {
    let sum = 0
    for (let i = o; i < n; i++) sum += Math.abs(predict(x, i, o))
    if (sum < bestSum) {
      bestSum = sum
      order = o
    }
  }
  if (n <= order) return verbatim
  const residual = new Int32Array(n - order)
  for (let i = order; i < n; i++) residual[i - order] = predict(x, i, order)
  const paramBits = bps > 16 ? 5 : 4
  const rice = chooseRice(residual, n, order, (1 << paramBits) - 2)
  const cost = 6 + order * bps + 2 + 4 + rice.params.length * paramBits + rice.bits
  return cost < verbatim.cost ? { kind: 'fixed', order, residual, partition: rice.partition, params: rice.params, cost } : verbatim
}

function predict(x: Int32Array, i: number, order: number): number {
  switch (order) {
    case 0:
      return x[i]
    case 1:
      return x[i] - x[i - 1]
    case 2:
      return x[i] - 2 * x[i - 1] + x[i - 2]
    case 3:
      return x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]
    default:
      return x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4]
  }
}

/** 残差を正の数にする（0, -1, 1, -2, … → 0, 1, 2, 3, …） */
const fold = (v: number) => (v >= 0 ? v * 2 : -v * 2 - 1)

/** パーティションの段数と、パーティションごとの Rice のパラメータを選ぶ */
function chooseRice(res: Int32Array, n: number, order: number, maxParam: number) {
  let best = { partition: 0, params: [] as number[], bits: Infinity }
  for (let p = 0; p <= MAX_PARTITION; p++) {
    const parts = 1 << p
    if (n % parts || (n >> p) <= order) break
    const params: number[] = []
    let total = 0
    let at = 0
    for (let k = 0; k < parts; k++) {
      const count = (n >> p) - (k === 0 ? order : 0)
      let sum = 0
      for (let i = at; i < at + count; i++) sum += fold(res[i])
      at += count
      // 長さに対して和から見積もり、その前後で一番短くなるものを選ぶ
      const guess = Math.max(0, Math.min(maxParam, Math.floor(Math.log2(sum / Math.max(1, count) + 1))))
      let bestParam = guess
      let bestBits = Infinity
      for (let r = Math.max(0, guess - 1); r <= Math.min(maxParam, guess + 1); r++) {
        const b = count * (r + 1) + Math.floor(sum / 2 ** r)
        if (b < bestBits) {
          bestBits = b
          bestParam = r
        }
      }
      params.push(bestParam)
      total += bestBits
    }
    if (total + parts * 5 < best.bits + best.params.length * 5) best = { partition: p, params, bits: total }
  }
  return best
}

function writeSubframe(w: BitWriter, x: Int32Array, bps: number, p: Plan) {
  const mask = bps >= 32 ? 0xffffffff : 2 ** bps - 1
  const sample = (v: number) => w.write((v < 0 ? v + 2 ** bps : v) & mask, bps)
  if (p.kind === 'constant') {
    w.write(0, 8)
    return sample(x[0])
  }
  if (p.kind === 'verbatim') {
    w.write(0x02, 8)
    return x.forEach(sample)
  }
  w.write((0x08 | p.order) << 1, 8)
  for (let i = 0; i < p.order; i++) sample(x[i])
  const paramBits = bps > 16 ? 5 : 4
  w.write(paramBits === 5 ? 1 : 0, 2)
  w.write(p.partition, 4)
  let at = 0
  const n = x.length
  p.params.forEach((r, k) => {
    w.write(r, paramBits)
    const count = (n >> p.partition) - (k === 0 ? p.order : 0)
    for (let i = at; i < at + count; i++) {
      const u = fold(p.residual[i])
      w.unary(Math.floor(u / 2 ** r))
      if (r) w.write(u % 2 ** r, r)
    }
    at += count
  })
}

const CRC8 = table(8, 0x07)
const CRC16 = table(16, 0x8005)

function table(width: number, poly: number) {
  const top = 1 << (width - 1)
  const mask = (1 << width) - 1
  return Array.from({ length: 256 }, (_, i) => {
    let c = i << (width - 8)
    for (let b = 0; b < 8; b++) c = c & top ? ((c << 1) ^ poly) & mask : (c << 1) & mask
    return c
  })
}

function crc8(data: Uint8Array) {
  let c = 0
  for (const b of data) c = CRC8[c ^ b]
  return c
}

function crc16(data: Uint8Array) {
  let c = 0
  for (const b of data) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b]
  return c
}

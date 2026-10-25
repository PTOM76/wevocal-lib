// WevPitch の処理方式 Vedict（リアルタイムの PSOLA）。processor に埋め込む JS の文字列。声の周期を求め、1 周期の粒を形を変えずに間隔を変えて並べ直す（フォルマントが自然に残る）

/** 遅れ（サンプル）。粒の前後 1.5 周期と、フォルマントで読み広げる分が入る長さ */
export const PSOLA_LATENCY = 2048

export const PSOLA_PROCESSOR = `
const PSOLA_LATENCY = ${PSOLA_LATENCY}
const RING = 8192
// 声の高さを求める間隔（サンプル）と、声とみなす相関の下限
const DETECT_EVERY = 256
const VOICED = 0.6
// フォルマントの倍率の範囲（粒を読み広げる分が遅れに収まるように）
const FR_MIN = 0.5
const FR_MAX = 1.75

// 目印は全チャンネルをまとめた音で決め、全チャンネルで共有する（定位を崩さない）
class Psola {
  constructor(channels, sr) {
    this.inb = Array.from({ length: channels }, () => new Float32Array(RING))
    this.out = Array.from({ length: channels }, () => new Float32Array(RING))
    this.mono = new Float32Array(RING)
    // 一番長い周期（48 kHz で約 80 Hz）。粒の前後 1.5 周期とフォルマントで読み広げる分が遅れに収まる長さ
    this.maxP = Math.floor((PSOLA_LATENCY - 64) / (1.5 + FR_MAX))
    this.minP = Math.max(16, Math.floor(sr / 1000))
    this.unvoiced = Math.round(sr * 0.005)
    this.period = this.unvoiced
    this.voiced = false
    this.n = 0
    this.nextDetect = 2 * this.maxP
    this.nextMark = 0
    this.ts = 0
    this.marks = []
    this.dec = new Float32Array(this.maxP)
    this.corr = new Float32Array(Math.floor(this.maxP / 2) + 2)
  }
  // 入力の位置 i の値（輪の外は 0。小数は直線で補う）
  at(buf, i) {
    if (i < 0 || i < this.n - RING + 1 || i > this.n - 1) return 0
    const a = Math.floor(i)
    const f = i - a
    const x = buf[a % RING]
    return f ? x + (buf[(a + 1) % RING] - x) * f : x
  }
  // 直近の最長 2 周期ぶんを半分に間引き、正規化した自己相関で周期を求める
  detect() {
    const d = this.dec
    const m = d.length
    const start = this.n - 2 * m
    let energy = 0
    for (let i = 0; i < m; i++) {
      d[i] = 0.5 * (this.mono[(start + 2 * i) % RING] + this.mono[(start + 2 * i + 1) % RING])
      energy += d[i] * d[i]
    }
    this.voiced = false
    this.period = this.unvoiced
    if (energy / m < 1e-8) return
    const r = this.corr
    const lo = Math.max(2, Math.floor(this.minP / 2))
    const hi = r.length - 2
    let best = 0
    for (let lag = lo - 1; lag <= hi + 1; lag++) {
      let dot = 0
      let e = 0
      for (let i = 0; i + lag < m; i++) {
        dot += d[i] * d[i + lag]
        e += d[i] * d[i] + d[i + lag] * d[i + lag]
      }
      r[lag] = e > 0 ? (2 * dot) / e : 0
      if (lag >= lo && lag <= hi && r[lag] > best) best = r[lag]
    }
    // 倍の周期を選ばないように、一番高い山の 0.85 倍を超える最初の山にする
    for (let lag = lo; lag <= hi; lag++) {
      if (r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1] && r[lag] >= best * 0.85 && r[lag] >= VOICED) {
        const den = r[lag - 1] - 2 * r[lag] + r[lag + 1]
        const shift = den < 0 ? (0.5 * (r[lag - 1] - r[lag + 1])) / den : 0
        this.period = 2 * (lag + shift)
        this.voiced = true
        return
      }
    }
  }
  // 目印を置く。声のある所は前の目印のまわり 1 周期と最も似ている位置、ない所は一定の間隔
  mark() {
    for (;;) {
      if (!this.voiced) {
        if (this.nextMark > this.n - 1) return
        this.marks.push({ pos: this.nextMark, P: this.unvoiced, voiced: false })
        this.nextMark += this.unvoiced
        continue
      }
      const P = this.period
      const half = Math.round(P / 2)
      const lo = Math.max(0, Math.round(this.nextMark - P * 0.3))
      const hi = Math.round(this.nextMark + P * 0.3)
      if (hi + half > this.n - 1) return
      const prev = this.marks.length ? this.marks[this.marks.length - 1] : null
      let pos = Math.round(this.nextMark)
      if (prev && prev.voiced && prev.pos - half > this.n - RING) {
        let bestScore = -Infinity
        for (let c = lo; c <= hi; c++) {
          let dot = 0
          let e = 0
          for (let k = -half; k < half; k++) {
            const b = this.mono[(c + k + RING) % RING]
            dot += this.mono[(prev.pos + k + RING) % RING] * b
            e += b * b
          }
          const score = dot / (Math.sqrt(e) + 1e-9)
          if (score > bestScore) {
            bestScore = score
            pos = c
          }
        }
      } else {
        let peak = -Infinity
        for (let c = lo; c <= hi; c++) {
          const v = this.mono[c % RING]
          if (v > peak) {
            peak = v
            pos = c
          }
        }
      }
      // 前の目印に近づきすぎたら、予定の位置にする
      if (prev && pos - prev.pos < P * 0.5) pos = Math.round(this.nextMark)
      this.marks.push({ pos, P, voiced: true })
      this.nextMark = pos + P
    }
  }
  // 出力の目印 ts に、入力の一番近い目印の粒を置く。声のある所は 周期 ÷ ratio の間隔で置き、粒はフォルマントの倍率 fr で読む
  synth(ratio, fr) {
    const marks = this.marks
    for (;;) {
      if (!marks.length) {
        if (this.ts + this.unvoiced > this.n) return
        this.ts += this.unvoiced
        continue
      }
      // 目印がその先まで置いてあるときだけ置く
      if (this.ts > marks[marks.length - 1].pos) return
      let m = marks[0]
      for (const x of marks) if (Math.abs(x.pos - this.ts) < Math.abs(m.pos - this.ts)) m = x
      const half = Math.max(1, Math.round(m.P))
      // 粒の終わりまで入力が届いていなければ待つ
      if (m.pos + half * Math.max(1, fr) > this.n - 1) return
      // 上げると粒の重なりが増えるので、その分だけ小さくする
      const gain = m.voiced ? Math.min(1, 1 / ratio) : 1
      const done = this.n - PSOLA_LATENCY
      for (let c = 0; c < this.out.length; c++) {
        const inb = this.inb[c]
        const out = this.out[c]
        for (let d = -half; d <= half; d++) {
          const t = Math.round(this.ts) + d
          // 出力済みの所には書かない
          if (t < done) continue
          const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / half)
          out[t % RING] += gain * w * this.at(inb, m.pos + d * fr)
        }
      }
      this.ts += m.voiced ? m.P / ratio : m.P
      // 使い終えた目印を捨てる
      while (marks.length > 1 && marks[1].pos < this.ts - 2 * this.maxP) marks.shift()
    }
  }
  // 1 サンプル（全チャンネル）を入れて、遅れの分だけ前のものを出す
  push(input, output, i, ratio, fr) {
    const k = this.n % RING
    let sum = 0
    for (let c = 0; c < this.inb.length; c++) {
      const x = (input[c] || input[0])[i]
      this.inb[c][k] = x
      sum += x
    }
    this.mono[k] = sum / this.inb.length
    this.n++
    if (this.n >= this.nextDetect) {
      this.detect()
      this.nextDetect += DETECT_EVERY
    }
    this.mark()
    this.synth(ratio, Math.max(FR_MIN, Math.min(FR_MAX, fr)))
    const o = this.n - 1 - PSOLA_LATENCY
    for (let c = 0; c < output.length; c++) output[c][i] = o < 0 ? 0 : this.out[Math.min(c, this.out.length - 1)][o % RING]
    if (o >= 0) for (const out of this.out) out[o % RING] = 0
  }
}
`

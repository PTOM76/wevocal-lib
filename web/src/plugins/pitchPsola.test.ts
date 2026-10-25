// WevPitch の Vedict（processor の文字列の PSOLA）のテスト。AudioWorklet の外で直接回す
import { describe, expect, it } from 'vitest'
import { PSOLA_LATENCY, PSOLA_PROCESSOR } from './pitchPsola'

interface Psola {
  push(input: Float32Array[], output: Float32Array[], i: number, ratio: number, fr: number): void
}
const Psola = new Function(`${PSOLA_PROCESSOR}; return Psola`)() as new (channels: number, sr: number) => Psola

const SR = 48000

/** 声の代わり: f0 Hz のパルス列を、800 Hz に山のある共振で響かせたもの */
function vowel(f0: number, seconds: number) {
  const n = Math.round(SR * seconds)
  const x = new Float32Array(n)
  const r = 0.97
  const w = (2 * Math.PI * 800) / SR
  const [a1, a2] = [2 * r * Math.cos(w), -r * r]
  let [y1, y2] = [0, 0]
  for (let i = 0; i < n; i++) {
    const pulse = Math.floor(((i + 1) * f0) / SR) > Math.floor((i * f0) / SR) ? 1 : 0
    const y = pulse + a1 * y1 + a2 * y2
    ;[y2, y1] = [y1, y]
    x[i] = y * 0.05
  }
  return x
}

function run(x: Float32Array, ratio: number, fr = 1) {
  const p = new Psola(1, SR)
  const y = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) {
    const out = [new Float32Array(1)]
    p.push([x.subarray(i, i + 1)], out, 0, ratio, fr)
    y[i] = out[0][0]
  }
  return y
}

/** 自己相関で求めた基本周波数（60〜1000 Hz） */
function f0Of(x: Float32Array) {
  let best = 0
  let lag = 0
  for (let l = Math.floor(SR / 1000); l <= SR / 60; l++) {
    let dot = 0
    let e = 0
    for (let i = 0; i + l < x.length; i++) {
      dot += x[i] * x[i + l]
      e += x[i] * x[i] + x[i + l] * x[i + l]
    }
    const r = (2 * dot) / (e || 1)
    if (r > best * 1.02) [best, lag] = [r, l]
  }
  return SR / lag
}

/** 重心（Hz。ゼロ交差の数から近似） */
const crossings = (x: Float32Array) => {
  let n = 0
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) n++
  return (n * SR) / x.length
}

const mid = (y: Float32Array) => y.subarray(PSOLA_LATENCY + SR * 0.3, PSOLA_LATENCY + SR * 0.8)

describe('Vedict（WevPitch）', () => {
  const x = vowel(150, 1.2)
  it('ピッチを上げ下げでき、響き（共振の山）は動かない', () => {
    const base = crossings(mid(x))
    for (const semi of [-5, 5, 12]) {
      const ratio = 2 ** (semi / 12)
      const y = run(x, ratio)
      expect(y.every(Number.isFinite)).toBe(true)
      expect(f0Of(mid(y)) / (150 * ratio)).toBeCloseTo(1, 1)
      // 共振の山（約 800 Hz）の上下で決まるゼロ交差は、ピッチほどは動かない
      expect(Math.abs(crossings(mid(y)) / base - 1)).toBeLessThan(0.25)
    }
  })
  it('変えないときは、遅れの分だけ遅れたほぼ元の音になる', () => {
    const y = run(x, 1)
    const a = x.subarray(SR * 0.3, SR * 0.8)
    const b = y.subarray(PSOLA_LATENCY + SR * 0.3, PSOLA_LATENCY + SR * 0.8)
    let [dot, ea, eb] = [0, 0, 0]
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      ea += a[i] * a[i]
      eb += b[i] * b[i]
    }
    expect(dot / Math.sqrt(ea * eb)).toBeGreaterThan(0.9)
    expect(Math.sqrt(eb / ea)).toBeGreaterThan(0.8)
    expect(Math.sqrt(eb / ea)).toBeLessThan(1.25)
  })
})

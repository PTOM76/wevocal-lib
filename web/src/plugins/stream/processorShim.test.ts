// processorShim.ts のテスト（手で書いた小さな processor を、AudioWorklet の外で回す）
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { installScope, loadProcessorSource, ProcessorRunner, QUANTUM, setFrame } from './processorShim'

// つまみ gain を掛け、1 サンプル遅らせ（前の 128 サンプルの最後を持ち越す）、出力の右に currentFrame の下位を入れる
const SOURCE = `
class Test extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'gain', defaultValue: 0.5, minValue: 0, maxValue: 2 }] }
  constructor(o) { super(o); this.last = 0; this.opt = o.processorOptions; this.port.postMessage({ hello: this.opt.tag }) }
  process(inputs, outputs, parameters) {
    const x = inputs[0][0], y = outputs[0][0], g = parameters.gain
    for (let i = 0; i < x.length; i++) {
      y[i] = this.last * (g.length > 1 ? g[i] : g[0])
      this.last = x[i]
    }
    outputs[0][1][0] = currentFrame % 1000
    outputs[0][1][1] = sampleRate
    return !this.stop
  }
}
registerProcessor('test-proc', Test)
`

describe('processorShim', () => {
  beforeAll(() => {
    installScope(44100)
    loadProcessorSource(SOURCE)
  })

  const ramp = (f: (i: number) => number) => Float32Array.from({ length: QUANTUM }, (_, i) => f(i))

  it('既定値のつまみで回し、状態は呼び出しをまたいで続く', () => {
    const r = new ProcessorRunner('test-proc', { tag: 'a' })
    const x = ramp((i) => i + 1)
    r.process(x, x)
    expect(r.outL[0]).toBe(0)
    expect(r.outL[1]).toBeCloseTo(0.5)
    r.process(x, x)
    // 前の 128 サンプルの最後（128）が持ち越される
    expect(r.outL[0]).toBeCloseTo(64)
  })

  it('値と値の列、範囲の外の値', () => {
    const r = new ProcessorRunner('test-proc', {})
    const x = ramp(() => 1)
    r.set('gain', 5)
    r.process(x, x)
    expect(r.outL[1]).toBe(2)
    r.process(x, x, { gain: ramp((i) => i / QUANTUM) })
    expect(r.outL[64]).toBeCloseTo(0.5)
  })

  it('時計と sampleRate、port の知らせ', async () => {
    const r = new ProcessorRunner('test-proc', { tag: 'b' })
    const got = new Promise((resolve) => (r.port.onmessage = (e) => resolve(e.data)))
    setFrame(1234)
    const x = new Float32Array(QUANTUM)
    r.process(x, x)
    expect(r.outR[0]).toBe(234)
    expect(r.outR[1]).toBe(44100)
    expect(await got).toEqual({ hello: 'b' })
    r.port.close()
  })

  it('SDK の見本の processor がそのまま動く', () => {
    loadProcessorSource(readFileSync(new URL('../../../../plugin-sdk/template-processor/src/processor.js', import.meta.url), 'utf8'))
    const r = new ProcessorRunner('wevocal-fx-example-gain', {})
    r.set('gain', 6)
    const x = ramp(() => 0.25)
    r.process(x, x)
    expect(r.outL[10]).toBeCloseTo(0.25 * 10 ** (6 / 20))
    expect(r.outR[10]).toBeCloseTo(0.25 * 10 ** (6 / 20))
  })

  it('登録していない名前は作れない', () => {
    expect(() => new ProcessorRunner('nope', {})).toThrow()
  })
})

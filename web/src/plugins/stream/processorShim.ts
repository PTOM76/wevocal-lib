// AudioWorklet の外（Worker）で、processor 方式のプラグインを 128 サンプルずつ回す。AudioWorkletGlobalScope の代わりを用意し、process を直接呼ぶ（memo/anticipate-stream.md）
/** 1 回の process で扱うサンプル数（AudioWorklet と同じ） */
export const QUANTUM = 128

/** processor のクラスが持つつまみの定義（AudioParamDescriptor の使う分） */
interface Descriptor {
  name: string
  defaultValue?: number
  minValue?: number
  maxValue?: number
}

interface ProcessorLike {
  port: MessagePort
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
}
type ProcessorClass = (new (options: unknown) => ProcessorLike) & { parameterDescriptors?: Descriptor[] }

/** 時計（currentFrame は回した分だけ進む） */
const clock = { sampleRate: 48000, frame: 0 }
/** registerProcessor されたクラス（名前ごと） */
const classes = new Map<string, ProcessorClass>()
/** 次に作る processor に渡す port（AudioWorkletProcessor の constructor が読む） */
let nextPort: MessagePort | null = null

/** AudioWorkletProcessor の代わり。port は作るときに渡したもの */
class ShimProcessor {
  readonly port: MessagePort
  constructor() {
    this.port = nextPort ?? new MessageChannel().port1
    nextPort = null
  }
}

/** このスコープ（Worker か、テスト）に、AudioWorkletGlobalScope の名前を置く。sampleRate は 1 つのスコープで 1 つ */
export function installScope(sampleRate: number) {
  clock.sampleRate = sampleRate
  const g = globalThis as Record<string, unknown>
  g.AudioWorkletProcessor = ShimProcessor
  g.registerProcessor = (name: string, cls: ProcessorClass) => classes.set(name, cls)
  for (const [key, get] of [
    ['sampleRate', () => clock.sampleRate],
    ['currentFrame', () => clock.frame],
    ['currentTime', () => clock.frame / clock.sampleRate],
  ] as const)
    Object.defineProperty(g, key, { get, configurable: true })
}

/** processor のソースを読み込む（中で registerProcessor が呼ばれる） */
export function loadProcessorSource(source: string) {
  new Function(source)()
}

/** 今の曲の位置にあたる時計を合わせる（プラグインが currentTime を transport と比べるため） */
export function setFrame(frame: number) {
  clock.frame = frame
}

/** 回している processor 1 つ。入力と出力はステレオ */
export class ProcessorRunner {
  private readonly proc: ProcessorLike
  private readonly descriptors: Descriptor[]
  /** つまみの今の値（無ければ既定値） */
  private readonly values = new Map<string, number>()
  private readonly inL = new Float32Array(QUANTUM)
  private readonly inR = new Float32Array(QUANTUM)
  readonly outL = new Float32Array(QUANTUM)
  readonly outR = new Float32Array(QUANTUM)
  /** process が false を返した（もう呼ばない。出力は無音） */
  ended = false
  /** メイン側に渡す port（__wevocalState などの知らせを受ける） */
  readonly port: MessagePort

  constructor(name: string, processorOptions: Record<string, unknown>) {
    const cls = classes.get(name)
    if (!cls) throw new Error(`processor not registered: ${name}`)
    const channel = new MessageChannel()
    this.port = channel.port2
    nextPort = channel.port1
    this.proc = new cls({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions })
    this.descriptors = cls.parameterDescriptors ?? []
  }

  /** つまみの値を入れる（次の process から） */
  set(id: string, value: number) {
    this.values.set(id, value)
  }

  /**
   * 128 サンプルを 1 回処理する。input は左右（短ければ 0 で埋める）。ramps を渡したつまみは、128 個の値の列で渡す（ならしやオートメーション）。
   * 出力は outL、outR に入る
   */
  process(inL: Float32Array, inR: Float32Array, ramps?: Record<string, Float32Array>) {
    this.outL.fill(0)
    this.outR.fill(0)
    if (this.ended) return
    this.inL.set(inL.subarray(0, QUANTUM))
    this.inR.set(inR.subarray(0, QUANTUM))
    const parameters: Record<string, Float32Array> = {}
    for (const d of this.descriptors) {
      const ramp = ramps?.[d.name]
      parameters[d.name] = ramp ?? new Float32Array([this.clamp(d, this.values.get(d.name) ?? d.defaultValue ?? 0)])
    }
    // 呼ばれるたびに中身を書き換えるプラグインもあるので、入力は写しを渡す
    const keep = this.proc.process([[this.inL, this.inR]], [[this.outL, this.outR]], parameters)
    if (!keep) this.ended = true
  }

  private clamp(d: Descriptor, v: number) {
    return Math.min(d.maxValue ?? Infinity, Math.max(d.minValue ?? -Infinity, v))
  }
}

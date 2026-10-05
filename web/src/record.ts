// マイクなどの入力元の一覧と、圧縮しない録音（AudioWorklet で生のサンプルを集める）
import type { Clip } from './types'

export interface InputDevice {
  id: string
  /** デバイス名（マイクの許可がないと空のことがある） */
  label: string
}

/** 入力元の一覧（既定の入力は含めない） */
export async function listInputDevices(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const all = await navigator.mediaDevices.enumerateDevices()
  return all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ id: d.deviceId, label: d.label }))
}

/** このブラウザで録音できるか（https か localhost で、マイクの API と AudioWorklet があるか） */
export const canRecord = () => !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined'

export interface InputOptions {
  /** 入力元のデバイス ID（'' は既定の入力） */
  deviceId: string
  /** ブラウザの加工（声の素材にするなら、すべてオフがよい） */
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

/** 入力元を開く（初回はマイクの許可を求める）。デバイスが見つからなければ既定の入力で開く */
export async function openInput(o: InputOptions): Promise<MediaStream> {
  const audio = (deviceId?: ConstrainDOMString): MediaTrackConstraints => ({
    deviceId,
    echoCancellation: o.echoCancellation,
    noiseSuppression: o.noiseSuppression,
    autoGainControl: o.autoGainControl,
    channelCount: { ideal: 2 },
  })
  if (!o.deviceId) return navigator.mediaDevices.getUserMedia({ audio: audio() })
  return navigator.mediaDevices.getUserMedia({ audio: audio({ exact: o.deviceId }) }).catch(() => navigator.mediaDevices.getUserMedia({ audio: audio() }))
}

/** 4096 サンプルずつまとめて送る AudioWorklet（128 サンプルごとに送るとメッセージが多すぎる） */
const WORKLET = `
class WevocalRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.buf = null; this.n = 0 }
  process(inputs) {
    const input = inputs[0]
    if (!input || !input.length) return true
    if (!this.buf) this.buf = input.map(() => new Float32Array(4096))
    const len = input[0].length
    for (let c = 0; c < this.buf.length; c++) this.buf[c].set(input[c] || input[0], this.n)
    this.n += len
    if (this.n + len > 4096) {
      this.port.postMessage(this.buf.map((b) => b.slice(0, this.n)))
      this.n = 0
    }
    return true
  }
}
registerProcessor('wevocal-recorder', WevocalRecorder)
`

export interface Recording {
  sampleRate: number
  /** 録った長さ（秒） */
  seconds(): number
  /** 前に呼んでからの最大の振幅（0〜1。メーター用） */
  peak(): number
  /** 止めて、録った音を返す（入力元も閉じる） */
  stop(): Promise<Clip>
  /** 止めて捨てる */
  cancel(): void
}

/** `stream` の録音を始める。止めるまで、生のサンプルをメモリに集める */
export async function startRecording(stream: MediaStream): Promise<Recording> {
  const ctx = new AudioContext()
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }
  const source = ctx.createMediaStreamSource(stream)
  const channels = Math.min(2, Math.max(1, stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1))
  const node = new AudioWorkletNode(ctx, 'wevocal-recorder', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: channels, channelCountMode: 'explicit' })
  // 出力を鳴らさない（音量 0 でつなぐのは、つないでいないと処理されないブラウザがあるため）
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(node)
  node.connect(mute).connect(ctx.destination)
  const chunks: Float32Array[][] = []
  let length = 0
  let peak = 0
  node.port.onmessage = (e: MessageEvent<Float32Array[]>) => {
    chunks.push(e.data)
    length += e.data[0].length
    for (const c of e.data) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]))
  }
  const close = () => {
    node.port.onmessage = null
    source.disconnect()
    node.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }
  return {
    sampleRate: ctx.sampleRate,
    seconds: () => length / ctx.sampleRate,
    peak: () => {
      const p = peak
      peak = 0
      return p
    },
    stop: async () => {
      close()
      const out = Array.from({ length: channels }, () => new Float32Array(length))
      let at = 0
      for (const chunk of chunks) {
        for (let c = 0; c < channels; c++) out[c].set(chunk[c] ?? chunk[0], at)
        at += chunk[0].length
      }
      return { sampleRate: ctx.sampleRate, channels: out }
    },
    cancel: close,
  }
}

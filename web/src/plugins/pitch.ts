// 標準のプラグイン wevocal.pitch（WevPitch。ピッチとフォルマントを、トラックのエフェクトとして、再生中にそのまま変える。processor 方式）
// 位相ボコーダー（STFT。1024 点、4 倍の重なり）。ピッチは周波数の目盛りを写し替えて変え、フォルマント（声の響きの形）は、
// ケプストラムで求めたスペクトルの包絡を、励起（包絡で割ったもの）から切り離して動かす。遅れは 768 サンプル。リアルタイム向けの簡易版（高域の細かさは、波形ブロックのピッチの処理方式に劣る）
import { makeExternalPlugin } from './external'
import type { PluginManifest } from '../../../plugin-sdk'

export const pitchManifest: PluginManifest = {
  id: 'wevocal.pitch',
  api: 1,
  kind: 'fx',
  format: 'wevocal',
  version: '1.0.0',
  author: 'WeVocal',
  name: 'name',
  latency: 768,
  params: [
    { id: 'pitch', name: 'param.pitch', min: -24, max: 24, default: 0, step: 0.01, unit: '' },
    { id: 'formant', name: 'param.formant', min: -12, max: 12, default: 0, step: 0.01, unit: '' },
    { id: 'keep', name: 'param.keep', min: 0, max: 1, default: 1, choices: ['keep.follow', 'keep.keep'] },
  ],
  tail: 0.05,
  processor: 'processor.js',
  lang: {
    ja_jp: { name: 'WevPitch', description: 'ピッチとフォルマント（声の響き）を、再生中にそのまま変えます。遅れは約 16 ミリ秒です', 'param.pitch': 'ピッチ（半音）', 'param.formant': 'フォルマント（半音）', 'param.keep': 'フォルマント', 'keep.follow': 'ピッチと一緒に動かす', 'keep.keep': '元のまま保つ' },
    en_us: { name: 'WevPitch', description: 'Changes pitch and formants (vocal tone) live during playback. Latency is about 16 ms.', 'param.pitch': 'Pitch (semitones)', 'param.formant': 'Formant (semitones)', 'param.keep': 'Formant', 'keep.follow': 'Follow the pitch', 'keep.keep': 'Keep the original' },
    ko_kr: { name: 'WevPitch', 'param.pitch': '피치(반음)', 'param.formant': '포먼트(반음)', 'param.keep': '포먼트', 'keep.follow': '피치와 함께 이동', 'keep.keep': '원래대로 유지' },
    zh_cn: { name: 'WevPitch', 'param.pitch': '音高（半音）', 'param.formant': '共振峰（半音）', 'param.keep': '共振峰', 'keep.follow': '随音高移动', 'keep.keep': '保持原样' },
    zh_tw: { name: 'WevPitch', 'param.pitch': '音高（半音）', 'param.formant': '共振峰（半音）', 'param.keep': '共振峰', 'keep.follow': '隨音高移動', 'keep.keep': '保持原樣' },
  },
}

const PROCESSOR = `
const N = 1024
const OS = 4
const STEP = N / OS
const LATENCY = N - STEP
const HALF = N / 2
const LIFTER = 40

// 実数と虚数の配列の FFT（基数 2。複素数。順方向）
function fft(re, im) {
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < N; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

const WIN = Float64Array.from({ length: N }, (_, i) => -0.5 * Math.cos((2 * Math.PI * i) / N) + 0.5)

class Channel {
  constructor() {
    this.inFIFO = new Float64Array(N)
    this.outFIFO = new Float64Array(N)
    this.accum = new Float64Array(2 * N)
    this.rover = LATENCY
    this.lastPhase = new Float64Array(HALF + 1)
    this.sumPhase = new Float64Array(HALF + 1)
    this.anaMagn = new Float64Array(HALF + 1)
    this.anaFreq = new Float64Array(HALF + 1)
    this.synMagn = new Float64Array(HALF + 1)
    this.synFreq = new Float64Array(HALF + 1)
    this.env = new Float64Array(HALF + 1)
    this.re = new Float64Array(N)
    this.im = new Float64Array(N)
    this.cr = new Float64Array(N)
    this.ci = new Float64Array(N)
  }
  /** 1 サンプルを入れて、1 サンプルを出す。ratio はピッチの倍率、fratio はフォルマントの倍率、useEnv は包絡を切り離すか */
  push(x, ratio, fratio, useEnv, sr) {
    this.inFIFO[this.rover] = x
    const y = this.outFIFO[this.rover - LATENCY]
    this.rover++
    if (this.rover >= N) {
      this.rover = LATENCY
      this.frame(ratio, fratio, useEnv, sr)
    }
    return y
  }
  frame(ratio, fratio, useEnv, sr) {
    const { re, im } = this
    const freqPerBin = sr / N
    const expct = (2 * Math.PI * STEP) / N
    for (let k = 0; k < N; k++) {
      re[k] = this.inFIFO[k] * WIN[k]
      im[k] = 0
    }
    fft(re, im)
    for (let k = 0; k <= HALF; k++) {
      const magn = 2 * Math.sqrt(re[k] * re[k] + im[k] * im[k])
      const phase = Math.atan2(im[k], re[k])
      let tmp = phase - this.lastPhase[k]
      this.lastPhase[k] = phase
      tmp -= k * expct
      let qpd = Math.trunc(tmp / Math.PI)
      qpd += qpd >= 0 ? qpd & 1 : -(qpd & 1)
      tmp -= Math.PI * qpd
      tmp = (OS * tmp) / (2 * Math.PI)
      this.anaMagn[k] = magn
      this.anaFreq[k] = k * freqPerBin + tmp * freqPerBin
    }
    // 包絡（ケプストラム）。対数の大きさを偶対称に並べて FFT し、低い次数だけ残して戻す
    if (useEnv) {
      const { cr, ci, env } = this
      for (let k = 0; k <= HALF; k++) {
        const l = Math.log(Math.max(this.anaMagn[k], 1e-9))
        cr[k] = l
        if (k > 0 && k < HALF) cr[N - k] = l
        ci[k] = 0
        if (k > 0 && k < HALF) ci[N - k] = 0
      }
      fft(cr, ci)
      for (let n = 0; n < N; n++) {
        const keep = n <= LIFTER || n >= N - LIFTER
        cr[n] = keep ? cr[n] / N : 0
        ci[n] = keep ? ci[n] / N : 0
      }
      fft(cr, ci)
      for (let k = 0; k <= HALF; k++) env[k] = Math.exp(cr[k])
      // 励起（包絡で割ったもの）にする
      for (let k = 0; k <= HALF; k++) this.anaMagn[k] /= env[k]
    }
    // ピッチの移動（周波数の目盛りを写し替える）
    this.synMagn.fill(0)
    this.synFreq.fill(0)
    for (let k = 0; k <= HALF; k++) {
      const index = Math.round(k * ratio)
      if (index <= HALF) {
        this.synMagn[index] += this.anaMagn[k]
        this.synFreq[index] = this.anaFreq[k] * ratio
      }
    }
    // フォルマントの移動（包絡を fratio 倍に引き伸ばして掛ける）
    if (useEnv) {
      for (let k = 0; k <= HALF; k++) {
        const src = k / fratio
        const i = Math.min(HALF - 1, Math.floor(src))
        const f = src - i
        const e = src >= HALF ? this.env[HALF] : this.env[i] * (1 - f) + this.env[i + 1] * f
        this.synMagn[k] *= e
      }
    }
    for (let k = 0; k <= HALF; k++) {
      const magn = this.synMagn[k]
      let tmp = this.synFreq[k]
      tmp -= k * freqPerBin
      tmp /= freqPerBin
      tmp = (2 * Math.PI * tmp) / OS
      tmp += k * expct
      this.sumPhase[k] += tmp
      const phase = this.sumPhase[k]
      re[k] = magn * Math.cos(phase)
      im[k] = magn * Math.sin(phase)
    }
    for (let k = HALF + 1; k < N; k++) {
      re[k] = 0
      im[k] = 0
    }
    // 逆変換（共役を取って順方向の FFT をして、もう一度共役にする。割らない）
    for (let k = 0; k < N; k++) im[k] = -im[k]
    fft(re, im)
    for (let k = 0; k < N; k++) this.accum[k] += (2 * WIN[k] * re[k]) / (HALF * OS)
    for (let k = 0; k < STEP; k++) this.outFIFO[k] = this.accum[k]
    this.accum.copyWithin(0, STEP, STEP + N)
    this.accum.fill(0, N, N + STEP)
    for (let k = 0; k < LATENCY; k++) this.inFIFO[k] = this.inFIFO[k + STEP]
  }
}

class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
      { name: 'formant', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
      { name: 'keep', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    this.ch = [new Channel(), new Channel()]
  }
  process(inputs, outputs, p) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input.length) return true
    const pitch = p.pitch[0]
    const formant = p.formant[0]
    const keep = p.keep[0] >= 0.5
    const ratio = Math.pow(2, pitch / 12)
    // 元のまま保つ: 包絡は formant だけ動かす。一緒に動かす: 包絡はピッチと同じだけ動き、さらに formant を足す
    const fratio = Math.pow(2, (keep ? formant : pitch + formant) / 12)
    // 包絡を切り離す必要があるのは、包絡の動きがピッチの動きと違うとき
    const useEnv = Math.abs(fratio - ratio) > 1e-4
    const n = input[0].length
    for (let c = 0; c < output.length; c++) {
      const src = input[c] || input[0]
      const ch = this.ch[Math.min(c, 1)]
      for (let i = 0; i < n; i++) output[c][i] = ch.push(src[i], ratio, fratio, useEnv, sampleRate)
    }
    return true
  }
}
registerProcessor('wevocal-fx-wevocal-pitch', PitchProcessor)
`

export const pitchPlugin = makeExternalPlugin({ manifest: pitchManifest, processor: PROCESSOR })

// 標準の解析と編集の道具。音を受け取って、道具は加工した音を、解析は結果の一覧を返す（純粋な関数。Worker にも載せられる）
import { registerStandardTools, type ToolInput, type ToolPlugin, type ToolResult } from './tools'
import type { PluginManifest } from '../../../plugin-sdk'

type Lang = Record<string, Record<string, string>>

const make = (id: string, kind: 'tool' | 'analyzer', params: PluginManifest['params'], lang: Lang, run: ToolPlugin['run']): ToolPlugin => {
  const manifest: PluginManifest = { id, api: 1, kind, format: 'wevocal', version: '1.0.0', author: 'WeVocal', name: 'name', params }
  return { manifest, lang, run }
}

const peakOf = (chs: Float32Array[]) => chs.reduce((m, c) => c.reduce((a, v) => Math.max(a, Math.abs(v)), m), 0)
const toDb = (v: number) => (v > 1e-9 ? 20 * Math.log10(v) : -Infinity)
const fmtDb = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : '-∞')

// --- 道具 ---

const reverse = make('wevocal.tool.reverse', 'tool', [], {
  ja_jp: { name: 'WevReverse', description: '音を逆向きにします', keywords: '逆再生 リバース' },
  en_us: { name: 'WevReverse', description: 'Reverses the audio.' },
  ko_kr: { name: 'WevReverse', keywords: '역재생' },
  zh_cn: { name: 'WevReverse', keywords: '倒放' },
  zh_tw: { name: 'WevReverse', keywords: '倒放' },
}, (i) => ({ channels: i.channels.map((c) => c.slice().reverse()) }))

const normalize = make('wevocal.tool.normalize', 'tool', [{ id: 'peak', name: 'param.peak', min: -24, max: 0, default: -1, step: 0.1, unit: 'dB' }], {
  ja_jp: { name: 'WevNormalize', description: '最大の音量を目標のピークにそろえます', keywords: 'ノーマライズ', 'param.peak': '目標のピーク' },
  en_us: { name: 'WevNormalize', description: 'Scales the audio so its peak reaches the target.', 'param.peak': 'Target peak' },
  ko_kr: { name: 'WevNormalize', keywords: '노멀라이즈', 'param.peak': '목표 피크' },
  zh_cn: { name: 'WevNormalize', keywords: '标准化', 'param.peak': '目标峰值' },
  zh_tw: { name: 'WevNormalize', keywords: '標準化', 'param.peak': '目標峰值' },
}, (i, v) => {
  const peak = peakOf(i.channels)
  const g = peak > 1e-9 ? 10 ** (v.peak / 20) / peak : 1
  return { channels: i.channels.map((c) => c.map((x) => x * g)) }
})

const dcRemove = make('wevocal.tool.dc', 'tool', [], {
  ja_jp: { name: 'WevDC', description: '音の中心のずれ（直流成分）を取り除きます', keywords: '直流成分の除去 DC' },
  en_us: { name: 'WevDC', description: 'Removes the DC offset.' },
  ko_kr: { name: 'WevDC', keywords: 'DC 오프셋 제거' },
  zh_cn: { name: 'WevDC', keywords: '去除直流偏移' },
  zh_tw: { name: 'WevDC', keywords: '移除直流偏移' },
}, (i) => ({
  channels: i.channels.map((c) => {
    let sum = 0
    for (const x of c) sum += x
    const mean = sum / (c.length || 1)
    return c.map((x) => x - mean)
  }),
}))

const mono = make('wevocal.tool.mono', 'tool', [], {
  ja_jp: { name: 'WevMono', description: '左右の音を 1 つにまとめます', keywords: 'モノラルにする' },
  en_us: { name: 'WevMono', description: 'Mixes the channels down to mono.' },
  ko_kr: { name: 'WevMono', keywords: '모노로 변환' },
  zh_cn: { name: 'WevMono', keywords: '转为单声道' },
  zh_tw: { name: 'WevMono', keywords: '轉為單聲道' },
}, (i) => {
  const n = i.channels[0].length
  const out = new Float32Array(n)
  for (const c of i.channels) for (let k = 0; k < n; k++) out[k] += c[k] / i.channels.length
  return { channels: i.channels.map(() => out.slice()) }
})

// --- 解析 ---

/** K 特性（BS.1770）のフィルターを掛けた音のラウドネス。400 ms の区間（75% 重なり）を、-70 LUFS と相対 -10 LU のゲートで平均する */
function loudness(input: ToolInput): number {
  const sr = input.sampleRate
  // 高域を持ち上げるシェルフと、低域を落とすハイパス（共通の設計式。48 kHz 以外でも同じ形になる）
  const shelf = (() => {
    const f0 = 1681.974450955533
    const G = 3.999843853973347
    const Q = 0.7071752369554196
    const K = Math.tan((Math.PI * f0) / sr)
    const Vh = 10 ** (G / 20)
    const Vb = Vh ** 0.4996667741545416
    const a0 = 1 + K / Q + K * K
    return { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] }
  })()
  const high = (() => {
    const f0 = 38.13547087602444
    const Q = 0.5003270373238773
    const K = Math.tan((Math.PI * f0) / sr)
    const a0 = 1 + K / Q + K * K
    return { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] }
  })()
  const biquad = (x: Float32Array, c: { b: number[]; a: number[] }) => {
    const y = new Float32Array(x.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let n = 0; n < x.length; n++) {
      const v = c.b[0] * x[n] + c.b[1] * x1 + c.b[2] * x2 - c.a[1] * y1 - c.a[2] * y2
      x2 = x1
      x1 = x[n]
      y2 = y1
      y1 = v
      y[n] = v
    }
    return y
  }
  const filtered = input.channels.map((c) => biquad(biquad(c, shelf), high))
  const block = Math.round(0.4 * sr)
  const hop = Math.round(0.1 * sr)
  const energies: number[] = []
  for (let s = 0; s + block <= filtered[0].length; s += hop) {
    let sum = 0
    for (const ch of filtered) {
      let e = 0
      for (let k = s; k < s + block; k++) e += ch[k] * ch[k]
      sum += e / block
    }
    energies.push(sum)
  }
  if (!energies.length) return -Infinity
  const lufs = (e: number) => -0.691 + 10 * Math.log10(e)
  const gated = energies.filter((e) => lufs(e) > -70)
  if (!gated.length) return -Infinity
  const rel = lufs(gated.reduce((a, b) => a + b, 0) / gated.length) - 10
  const kept = gated.filter((e) => lufs(e) > rel)
  return kept.length ? lufs(kept.reduce((a, b) => a + b, 0) / kept.length) : -Infinity
}

const loudnessTool = make('wevocal.analyzer.loudness', 'analyzer', [], {
  ja_jp: { name: 'WevLoudness', description: 'ピーク、RMS、統合ラウドネスなどを調べます', keywords: 'ラウドネスとピーク 音量 解析', length: '長さ', peak: 'ピーク', rms: 'RMS', lufs: 'ラウドネス（統合）', crest: 'クレストファクター', dc: '直流成分', clip: 'クリップしたサンプル' },
  en_us: { name: 'WevLoudness', description: 'Measures peak, RMS, integrated loudness and more.', length: 'Length', peak: 'Peak', rms: 'RMS', lufs: 'Loudness (integrated)', crest: 'Crest factor', dc: 'DC offset', clip: 'Clipped samples' },
  ko_kr: { name: 'WevLoudness', keywords: '라우드니스와 피크', length: '길이', peak: '피크', rms: 'RMS', lufs: '라우드니스(통합)', crest: '크레스트 팩터', dc: 'DC 오프셋', clip: '클리핑된 샘플' },
  zh_cn: { name: 'WevLoudness', keywords: '响度与峰值', length: '长度', peak: '峰值', rms: 'RMS', lufs: '响度（综合）', crest: '波峰因数', dc: '直流偏移', clip: '削波采样' },
  zh_tw: { name: 'WevLoudness', keywords: '響度與峰值', length: '長度', peak: '峰值', rms: 'RMS', lufs: '響度（整合）', crest: '波峰因數', dc: '直流偏移', clip: '削波取樣' },
}, (i): ToolResult => {
  const n = i.channels[0].length
  let sq = 0
  let sum = 0
  let clipped = 0
  for (const c of i.channels) {
    for (const x of c) {
      sq += x * x
      sum += x
      if (Math.abs(x) >= 0.9999) clipped++
    }
  }
  const total = n * i.channels.length || 1
  const peak = peakOf(i.channels)
  const rms = Math.sqrt(sq / total)
  return {
    rows: [
      { key: 'length', value: Math.round((n / i.sampleRate) * 1000) / 1000, unit: 's' },
      { key: 'peak', value: fmtDb(toDb(peak)), unit: 'dBFS' },
      { key: 'rms', value: fmtDb(toDb(rms)), unit: 'dBFS' },
      { key: 'lufs', value: fmtDb(loudness(i)), unit: 'LUFS' },
      { key: 'crest', value: fmtDb(toDb(peak) - toDb(rms)), unit: 'dB' },
      { key: 'dc', value: Math.round((sum / total) * 1e5) / 1e5 },
      { key: 'clip', value: clipped },
    ],
  }
})

/** 実数列の FFT（基数 2。長さは 2 のべき乗）。re と im を書き換える */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
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

const spectrumTool = make('wevocal.analyzer.spectrum', 'analyzer', [], {
  ja_jp: { name: 'WevSpectrum', description: '一番強い周波数や、明るさ、帯域ごとの割合を調べます', keywords: 'スペクトルの特徴 周波数 解析', dominant: '一番強い周波数', centroid: '重心（明るさ）', rolloff: '85% の周波数（ロールオフ）', bandLow: '低域（〜250 Hz）の割合', bandMid: '中域（250 Hz〜4 kHz）の割合', bandHigh: '高域（4 kHz〜）の割合' },
  en_us: { name: 'WevSpectrum', description: 'Measures the dominant frequency, brightness and band balance.', dominant: 'Dominant frequency', centroid: 'Centroid (brightness)', rolloff: '85% roll-off frequency', bandLow: 'Low band (to 250 Hz)', bandMid: 'Mid band (250 Hz to 4 kHz)', bandHigh: 'High band (4 kHz and up)' },
  ko_kr: { name: 'WevSpectrum', keywords: '스펙트럼 요약', dominant: '가장 강한 주파수', centroid: '중심(밝기)', rolloff: '85% 롤오프 주파수', bandLow: '저역(250 Hz까지) 비율', bandMid: '중역(250 Hz~4 kHz) 비율', bandHigh: '고역(4 kHz~) 비율' },
  zh_cn: { name: 'WevSpectrum', keywords: '频谱概要', dominant: '最强频率', centroid: '重心（明亮度）', rolloff: '85% 滚降频率', bandLow: '低频（250 Hz 以下）占比', bandMid: '中频（250 Hz 至 4 kHz）占比', bandHigh: '高频（4 kHz 以上）占比' },
  zh_tw: { name: 'WevSpectrum', keywords: '頻譜概要', dominant: '最強頻率', centroid: '重心（明亮度）', rolloff: '85% 滾降頻率', bandLow: '低頻（250 Hz 以下）占比', bandMid: '中頻（250 Hz 至 4 kHz）占比', bandHigh: '高頻（4 kHz 以上）占比' },
}, (i): ToolResult => {
  const N = 4096
  const mono = new Float32Array(i.channels[0].length)
  for (const c of i.channels) for (let k = 0; k < mono.length; k++) mono[k] += c[k] / i.channels.length
  const power = new Float64Array(N / 2)
  const win = Float64Array.from({ length: N }, (_, k) => 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1)))
  const hop = N / 2
  let frames = 0
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let s = 0; s + N <= mono.length; s += hop) {
    for (let k = 0; k < N; k++) {
      re[k] = mono[s + k] * win[k]
      im[k] = 0
    }
    fft(re, im)
    for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k]
    frames++
  }
  if (!frames) return { rows: [] }
  const hz = (k: number) => (k * i.sampleRate) / N
  let total = 0
  let weighted = 0
  let best = 1
  for (let k = 1; k < N / 2; k++) {
    total += power[k]
    weighted += power[k] * hz(k)
    if (power[k] > power[best]) best = k
  }
  let acc = 0
  let roll = 0
  for (let k = 1; k < N / 2; k++) {
    acc += power[k]
    if (acc >= total * 0.85) {
      roll = hz(k)
      break
    }
  }
  const band = (lo: number, hi: number) => {
    let e = 0
    for (let k = 1; k < N / 2; k++) if (hz(k) >= lo && hz(k) < hi) e += power[k]
    return total > 0 ? Math.round((e / total) * 1000) / 10 : 0
  }
  return {
    rows: [
      { key: 'dominant', value: Math.round(hz(best)), unit: 'Hz' },
      { key: 'centroid', value: total > 0 ? Math.round(weighted / total) : 0, unit: 'Hz' },
      { key: 'rolloff', value: Math.round(roll), unit: 'Hz' },
      { key: 'bandLow', value: band(0, 250), unit: '%' },
      { key: 'bandMid', value: band(250, 4000), unit: '%' },
      { key: 'bandHigh', value: band(4000, Infinity), unit: '%' },
    ],
  }
})

registerStandardTools([normalize, reverse, dcRemove, mono, loudnessTool, spectrumTool])

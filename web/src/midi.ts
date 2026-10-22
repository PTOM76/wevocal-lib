/**
 * 標準 MIDI ファイル（.mid、形式 0 / 1）の読み込み。ピッチに当てはめるための音符（高さと、秒単位の始まり・終わり）だけを取り出す。
 * テンポの変化（FF 51）はすべてのトラックから集めて、ティックを秒に直すのに使う
 */

export interface MidiNote {
  /** MIDI ノート番号（C4 = 60） */
  note: number
  /** 始まり・終わり（秒） */
  start: number
  end: number
  /** 始まり・終わり（拍。4 分音符 = 1。ファイルのテンポによらず、音楽上の位置） */
  startBeat: number
  endBeat: number
  /** 強さ 0〜1 */
  vel: number
  /** チャンネル 0〜15 */
  ch: number
}

export interface MidiTrack {
  name: string
  notes: MidiNote[]
}

/** テンポの変化（拍の位置とそこからの BPM） */
export interface MidiTempo {
  beat: number
  bpm: number
}

export interface MidiFile {
  /** 音符のあるトラックだけ */
  tracks: MidiTrack[]
  /** 最初のテンポ（BPM）。テンポの指定が無ければ 120 */
  bpm: number
  /** テンポの変化（拍の順。最初のテンポも含む。指定が無ければ空） */
  tempos: MidiTempo[]
  /** 最初の拍子（1 小節の拍数を 4 分音符の数で。6/8 なら 3）。指定が無ければ 4 */
  beatsPerBar: number
}

/** 可変長の数値と、読み終えた位置 */
function readVarLen(v: DataView, at: number): [number, number] {
  let n = 0
  for (;;) {
    const b = v.getUint8(at++)
    n = (n << 7) | (b & 0x7f)
    if (!(b & 0x80)) return [n, at]
  }
}

interface RawNote {
  note: number
  on: number
  off: number
  vel: number
  ch: number
}

/** .mid を読む。形式が違えば例外 */
export function parseMidi(buf: ArrayBuffer): MidiFile {
  const v = new DataView(buf)
  const text = (at: number, n: number) => String.fromCharCode(...new Uint8Array(buf, at, n))
  if (buf.byteLength < 14 || text(0, 4) !== 'MThd') throw new Error('not a MIDI file')
  const ntrks = v.getUint16(10)
  const division = v.getUint16(12)
  if (division & 0x8000) throw new Error('SMPTE time division is not supported')

  const tempos: { tick: number; usPerQuarter: number }[] = []
  let beatsPerBar = 0
  const raw: { name: string; notes: RawNote[] }[] = []
  let at = 8 + v.getUint32(4)
  for (let ti = 0; ti < ntrks && at + 8 <= buf.byteLength; ti++) {
    if (text(at, 4) !== 'MTrk') break
    const end = at + 8 + v.getUint32(at + 4)
    let p = at + 8
    let tick = 0
    let status = 0
    let name = ''
    const notes: RawNote[] = []
    /** 鳴っている音（チャンネルと高さごと）。同じ音が重なったら先に鳴ったものから止める */
    const open = new Map<number, { tick: number; vel: number }[]>()
    while (p < end) {
      const [delta, q] = readVarLen(v, p)
      p = q
      tick += delta
      let b = v.getUint8(p)
      if (b & 0x80) {
        status = b
        p++
      } else b = status // ランニングステータス
      const type = status & 0xf0
      if (status === 0xff) {
        const meta = v.getUint8(p++)
        const [len, q2] = readVarLen(v, p)
        p = q2
        if (meta === 0x51 && len === 3) tempos.push({ tick, usPerQuarter: (v.getUint8(p) << 16) | (v.getUint8(p + 1) << 8) | v.getUint8(p + 2) })
        // 拍子（分子と分母の 2 のべき乗）。最初のものを使い、4 分音符の数にする
        if (meta === 0x58 && len >= 2 && !beatsPerBar) beatsPerBar = (v.getUint8(p) * 4) / 2 ** v.getUint8(p + 1)
        if (meta === 0x03 && !name) name = new TextDecoder().decode(new Uint8Array(buf, p, len))
        p += len
      } else if (status === 0xf0 || status === 0xf7) {
        const [len, q2] = readVarLen(v, p)
        p = q2 + len
      } else if (type === 0x90 || type === 0x80) {
        const key = ((status & 0x0f) << 8) | v.getUint8(p)
        const vel = v.getUint8(p + 1)
        p += 2
        if (type === 0x90 && vel > 0) {
          const list = open.get(key) ?? []
          list.push({ tick, vel })
          open.set(key, list)
        } else {
          const on = open.get(key)?.shift()
          if (on !== undefined) notes.push({ note: key & 0xff, on: on.tick, off: tick, vel: on.vel / 127, ch: key >> 8 })
        }
      } else if (type === 0xc0 || type === 0xd0) p += 1
      else p += 2
    }
    if (notes.length) raw.push({ name: name.trim() || `Track ${ti + 1}`, notes })
    at = end
  }

  // ティック → 秒（テンポの変化に従う）
  tempos.sort((a, b) => a.tick - b.tick)
  const segs: { tick: number; sec: number; spt: number }[] = [{ tick: 0, sec: 0, spt: 0.5 / division }]
  for (const tp of tempos) {
    const last = segs[segs.length - 1]
    const sec = last.sec + (tp.tick - last.tick) * last.spt
    const spt = tp.usPerQuarter / 1e6 / division
    if (tp.tick === last.tick) segs[segs.length - 1] = { ...last, spt }
    else segs.push({ tick: tp.tick, sec, spt })
  }
  const toSec = (tick: number) => {
    let s = segs[0]
    for (const x of segs) if (x.tick <= tick) s = x
    return s.sec + (tick - s.tick) * s.spt
  }
  const perQuarter = (tick: number) => tick / division
  const firstTempo = tempos.find((tp) => tp.tick === 0) ?? tempos[0]
  return {
    beatsPerBar: beatsPerBar > 0 ? beatsPerBar : 4,
    tempos: tempos.map((tp) => ({ beat: perQuarter(tp.tick), bpm: Math.round((60e6 / tp.usPerQuarter) * 100) / 100 })),
    bpm: firstTempo ? Math.round((60e6 / firstTempo.usPerQuarter) * 100) / 100 : 120,
    tracks: raw.map((tr) => ({
      name: tr.name,
      notes: tr.notes.map((n) => ({ note: n.note, start: toSec(n.on), end: toSec(n.off), startBeat: perQuarter(n.on), endBeat: perQuarter(n.off), vel: n.vel, ch: n.ch })).sort((a, b) => a.start - b.start),
    })),
  }
}

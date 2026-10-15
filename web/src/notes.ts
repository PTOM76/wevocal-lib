/** 音名（C から B まで、シャープ表記） */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** 周波数（Hz）→ MIDI ノート番号（A4 = 69、小数あり） */
export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

/** MIDI ノート番号 → 周波数（Hz） */
export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12)

/** MIDI ノート番号（整数）→ 「C4」のような音名 */
export const noteName = (m: number) => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`

/** MIDI ノート番号（小数あり）→ 「A3 +12¢」のような、最寄りの音名とのずれ付き表記 */
export function describePitch(midi: number) {
  const n = Math.round(midi)
  const cents = Math.round((midi - n) * 100)
  return cents === 0 ? noteName(n) : `${noteName(n)} ${cents > 0 ? '+' : ''}${cents}¢`
}

/** 値の中央値（空なら null） */
export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

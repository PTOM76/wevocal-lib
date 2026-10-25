// ピッチ変更と時間伸縮の処理方式（WeVocalSynth と WeVocal Studio で共通。Rust 側 `Algorithm::from_id` と対応）

/** wsola / pv は従来の方式、psola はボーカル向けの方式。sola2 / sola3 / psola2 / wsola2 / pv2 は改良版（従来版も残して選べる）。psolad は PSOLA でリサンプルせずにピッチを変える方式（フォルマントが自然）。hpss は打楽器分離のハイブリッド。sms は試験的な方式（愛称 Specraw） */
export type Algorithm = 'wsola' | 'pv' | 'psola' | 'sola' | 'psola2' | 'wsola2' | 'pv2' | 'hpss' | 'sola2' | 'sola3' | 'sms' | 'psolad'

/** wasm に渡す番号。保存したデータや Rust 側と合わせるため、番号は変えない */
export const ALGORITHM_ID: Record<Algorithm, number> = { wsola: 0, pv: 1, psola: 2, sola: 3, psola2: 4, wsola2: 5, pv2: 6, hpss: 7, sola2: 8, sola3: 9, sms: 10, psolad: 11 }

/** 画面に出す名前（どの言語でも同じ）。選ぶ一覧はこの並び */
export const ALGORITHM_NAMES: Record<Algorithm, string> = {
  sola3: 'Vesola',
  sola2: 'Solis',
  psola2: 'Pisol',
  psolad: 'Pisol Direct',
  wsola2: 'Wevia',
  pv2: 'Phasera v2',
  pv: 'Phasera',
  hpss: 'HPSS',
  sms: 'Specraw',
  sola: 'Legacy Solis',
  psola: 'Legacy Pisol',
  wsola: 'Legacy Wevia',
}

// TODO: hintはわけたい. eg: algorithm.sola2とalgorithm.sola2.hint、タイプもわけたほうがきれい
/** 処理方式の名前と説明の訳文のキー（アプリの訳文に同じキーを置く） */
export type AlgorithmKey =
  | 'algorithm.sola2'
  | 'algorithm.sola2Hint'
  | 'algorithm.sola3'
  | 'algorithm.sola3Hint'
  | 'algorithm.sola'
  | 'algorithm.solaHint'
  | 'algorithm.psola2'
  | 'algorithm.psola2Hint'
  | 'algorithm.psolad'
  | 'algorithm.psoladHint'
  | 'algorithm.psola'
  | 'algorithm.psolaHint'
  | 'algorithm.wsola2'
  | 'algorithm.wsola2Hint'
  | 'algorithm.wsola'
  | 'algorithm.wsolaHint'
  | 'algorithm.hpss'
  | 'algorithm.hpssHint'
  | 'algorithm.pv2'
  | 'algorithm.pv2Hint'
  | 'algorithm.pv'
  | 'algorithm.pvHint'
  | 'algorithm.sms'
  | 'algorithm.smsHint'

/**
 * 選べる処理方式。新しい方式を入れても前の方式は残し、ここから選べるようにする。
 * `legacy` は改良版がある従来の方式で、設定の「従来の処理方式も表示する」を入れたときだけ出す（多すぎて選びにくいため）。
 * `experimental` は試験的な方式で、設定の開発者向けで入れたときだけ出す
 */
export const ALGORITHMS: { value: Algorithm; label: AlgorithmKey; hint: AlgorithmKey; legacy?: true; experimental?: true }[] = [
  { value: 'sola2', label: 'algorithm.sola2', hint: 'algorithm.sola2Hint' },
  { value: 'sola3', label: 'algorithm.sola3', hint: 'algorithm.sola3Hint' },
  { value: 'sola', label: 'algorithm.sola', hint: 'algorithm.solaHint', legacy: true },
  { value: 'psola2', label: 'algorithm.psola2', hint: 'algorithm.psola2Hint' },
  { value: 'psolad', label: 'algorithm.psolad', hint: 'algorithm.psoladHint' },
  { value: 'psola', label: 'algorithm.psola', hint: 'algorithm.psolaHint', legacy: true },
  { value: 'wsola2', label: 'algorithm.wsola2', hint: 'algorithm.wsola2Hint' },
  { value: 'wsola', label: 'algorithm.wsola', hint: 'algorithm.wsolaHint', legacy: true },
  { value: 'hpss', label: 'algorithm.hpss', hint: 'algorithm.hpssHint' },
  { value: 'pv2', label: 'algorithm.pv2', hint: 'algorithm.pv2Hint' },
  { value: 'pv', label: 'algorithm.pv', hint: 'algorithm.pvHint' },
  { value: 'sms', label: 'algorithm.sms', hint: 'algorithm.smsHint', experimental: true },
]

/** 試験的な方式を出すか（設定の開発者向け。App で設定に合わせる） */
let experimental = false
export const setExperimentalAlgorithms = (on: boolean) => {
  experimental = on
}

/** 表示する処理方式。従来の方式は `showLegacy` のとき、試験的な方式は設定で入れたときだけ。ただし `keep`（今選んでいるもの）は隠さない */
export function visibleAlgorithms(showLegacy: boolean, keep: Algorithm[] = []) {
  return ALGORITHMS.filter((a) => keep.includes(a.value) || ((showLegacy || !a.legacy) && (experimental || !a.experimental)))
}


// ピッチ変更と時間伸縮の処理方式（WeVocalSynth と WeVocal Studio で共通。Rust 側 `Algorithm::from_id` と対応）

/** wsola / pv は従来の方式、psola はボーカル向けの方式。sola2 / sola3 / psola2 / wsola2 / pv2 は改良版（従来版も残して選べる）。hpss は打楽器分離のハイブリッド。sms は試験的な方式（愛称 Specraw） */
export type Algorithm = 'wsola' | 'pv' | 'psola' | 'sola' | 'psola2' | 'wsola2' | 'pv2' | 'hpss' | 'sola2' | 'sola3' | 'sms'

/** wasm に渡す番号。保存したデータや Rust 側と合わせるため、番号は変えない */
export const ALGORITHM_ID: Record<Algorithm, number> = { wsola: 0, pv: 1, psola: 2, sola: 3, psola2: 4, wsola2: 5, pv2: 6, hpss: 7, sola2: 8, sola3: 9, sms: 10 }

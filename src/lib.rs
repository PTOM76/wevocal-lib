//! WeVocalSynth、WeVocal Studio、WeVocalExtractor で共有する信号処理の部品。
//!
//! - `fft`: radix-2 FFT
//! - `resample`: 窓付き sinc 補間のリサンプル
//! - `stft`: STFT / 逆STFT（周期的な Hann 窓、center なし）
//! - `window`: 窓関数（周期的な Hann 窓）
//! - `math`: 速い近似の ln / exp、位相の折り返し、中央値
//! - `f0`: YIN による F0（声の高さ）の推定
//! - `tempo`: テンポ（BPM と 1 拍目の位置）の解析
//! - `onset`: 音の立ち上がり（破裂音など）の検出
//! - `lpc`: 線形予測（LPC）の係数、包絡、全極フィルター
//!
//! ピッチ変更と時間伸縮（WeVocalSynth から移した。処理方式は `Algorithm` で選ぶ）:
//! - `pipeline`: 伸縮 → フォルマント補正 → リサンプルの流れ（`process_with_progress`）
//! - `wsola`、`pv`、`psola`、`sola`、`sola2`、`hpss`、`sms`: 時間伸縮の方式
//! - `formant`: フォルマント補正、`curve`: ピッチカーブ、`segment`: 区間に分けた並列の加工
//! - `timemap`: 出力位置 → 入力位置の時間対応

pub mod curve;
pub mod f0;
pub mod fft;
pub mod formant;
pub mod hpss;
pub mod lpc;
pub mod math;
pub mod onset;
mod pipeline;
pub mod psola;
pub mod pv;
pub mod resample;
pub mod segment;
pub mod sms;
pub mod sola;
pub mod sola2;
pub mod stft;
pub mod tempo;
mod timemap;
pub mod window;
mod wsola;

pub use pipeline::{process, process_with_progress, Algorithm, Formant};
pub use resample::{resample, resample_with};
pub use timemap::TimeMap;
pub use wsola::{wsola, wsola2, wsola2_map, wsola_map, wsola_with_progress};

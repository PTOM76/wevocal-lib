//! WeVocalSynth と WeVocalExtractor で共有する信号処理の部品。
//!
//! - `fft`: radix-2 FFT
//! - `resample`: 窓付き sinc 補間のリサンプル
//!
//! STFT / 逆STFT も今後ここに置く（いまは WeVocalExtractor 側に TypeScript 版がある）。

pub mod fft;
pub mod resample;

pub use resample::{resample, resample_with};

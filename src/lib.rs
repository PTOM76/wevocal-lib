//! WeVocalSynth と WeVocalExtractor で共有する信号処理の部品。
//!
//! - `fft`: radix-2 FFT
//! - `resample`: 窓付き sinc 補間のリサンプル
//! - `stft`: STFT / 逆STFT（周期的な Hann 窓、center なし）

pub mod fft;
pub mod resample;
pub mod stft;

pub use resample::{resample, resample_with};

//! WeVocalSynth と WeVocalExtractor で共有する信号処理の部品。
//!
//! - `fft`: radix-2 FFT
//! - `resample`: 窓付き sinc 補間のリサンプル
//! - `stft`: STFT / 逆STFT（周期的な Hann 窓、center なし）
//! - `window`: 窓関数（周期的な Hann 窓）
//! - `math`: 速い近似の ln / exp、位相の折り返し、中央値

pub mod fft;
pub mod math;
pub mod resample;
pub mod stft;
pub mod window;

pub use resample::{resample, resample_with};

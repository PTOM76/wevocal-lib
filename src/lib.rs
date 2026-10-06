//! WeVocalSynth と WeVocalExtractor で共有する信号処理の部品。
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

pub mod f0;
pub mod fft;
pub mod lpc;
pub mod math;
pub mod onset;
pub mod resample;
pub mod stft;
pub mod tempo;
pub mod window;

pub use resample::{resample, resample_with};

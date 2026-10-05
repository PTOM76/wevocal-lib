//! 窓関数。

use std::f64::consts::PI;

/// 長さ `n` の周期的な Hann 窓（先頭は 0、中央は 1。torch.hann_window と同じ）。50% や 75% の重なりで、足すと一定になる
pub fn hann(n: usize) -> Vec<f32> {
    (0..n).map(|i| (0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos()) as f32).collect()
}

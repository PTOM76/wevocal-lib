//! 音の立ち上がり（破裂音、打楽器など）の検出。

/// 立ち上がりの位置（サンプル）。1ms ごとのエネルギーが、直前 10ms の平均の 10 倍を超え、全体の平均の 1/4 以上の所。
/// 同じ立ち上がりを何度も数えないよう、見つけたら 20ms 先から探し直す
pub fn energy_onsets(x: &[f32], sample_rate: f32) -> Vec<i64> {
    let w = (sample_rate * 0.001).max(1.0) as usize;
    let e: Vec<f32> = x.chunks(w).map(|c| c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32).collect();
    let mean = e.iter().sum::<f32>() / e.len().max(1) as f32;
    let mut out = Vec::new();
    let mut k = 10;
    while k < e.len() {
        let before = e[k - 10..k].iter().sum::<f32>() / 10.0;
        if e[k] > before * 10.0 + 1e-12 && e[k] > mean * 0.25 {
            out.push((k * w) as i64);
            k += 20;
        } else {
            k += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 無音のあとの短い音の頭を見つけ、続く音の中では数えない
    #[test]
    fn finds_burst_after_silence() {
        let sr = 48000.0;
        let mut x = vec![0.0f32; 48000];
        for (i, v) in x[24000..24480].iter_mut().enumerate() {
            *v = ((i as f32) * 0.3).sin() * 0.5
        }
        let o = energy_onsets(&x, sr);
        assert_eq!(o.len(), 1);
        assert!((o[0] - 24000).abs() <= 48);
    }
}

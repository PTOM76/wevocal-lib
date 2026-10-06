//! 線形予測（LPC）。自己相関法と Levinson-Durbin で係数を求める。
//! フォルマントの推定（WeVocalAnalyzer）と、声の響き（スペクトル包絡）の分析と合成（WeVocalSynth）で使う。

/// `x`（窓を掛けたフレーム）の LPC 係数 a[0..=order]（a[0] = 1）と、予測誤差の大きさ（残差のエネルギー）。
/// 予測の式は x[n] ≈ -(a[1] x[n-1] + … + a[order] x[n-order])。無音などで求まらなければ None。
pub fn lpc(x: &[f32], order: usize) -> Option<(Vec<f32>, f32)> {
    if x.len() <= order {
        return None;
    }
    let r: Vec<f64> = (0..=order).map(|lag| x[lag..].iter().zip(x).map(|(&a, &b)| a as f64 * b as f64).sum()).collect();
    if r[0] < 1e-10 {
        return None;
    }
    let mut a = vec![0.0f64; order + 1];
    a[0] = 1.0;
    let mut err = r[0];
    for i in 1..=order {
        let acc: f64 = (1..i).map(|j| a[j] * r[i - j]).sum();
        let k = -(r[i] + acc) / err;
        let prev = a.clone();
        for j in 1..i {
            a[j] = prev[j] + k * prev[i - j];
        }
        a[i] = k;
        err *= 1.0 - k * k;
        if err <= 0.0 {
            return None;
        }
    }
    Some((a.iter().map(|&v| v as f32).collect(), err as f32))
}

/// LPC の包絡の大きさ |1 / A(e^{jω})|² を、0〜ナイキストを `points` 点に分けた周波数で返す（山の位置を見るためのもの）
pub fn envelope(a: &[f32], points: usize) -> Vec<f32> {
    (0..points)
        .map(|g| {
            let w = std::f32::consts::PI * g as f32 / (points - 1).max(1) as f32;
            let (mut re, mut im) = (0.0f32, 0.0f32);
            for (k, &c) in a.iter().enumerate() {
                re += c * (w * k as f32).cos();
                im -= c * (w * k as f32).sin();
            }
            1.0 / (re * re + im * im + 1e-12)
        })
        .collect()
}

/// 全極フィルター 1 / A(z) を `x` に掛ける（`state` は直前の出力。長さは次数。続けて呼ぶとつながる）
pub fn synthesize(a: &[f32], x: &[f32], state: &mut [f32], out: &mut [f32]) {
    let order = a.len() - 1;
    for (i, &v) in x.iter().enumerate() {
        let mut y = v;
        for k in 1..=order {
            y -= a[k] * state[k - 1];
        }
        state.copy_within(0..order - 1, 1);
        state[0] = y;
        out[i] = y;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2 次の共振（1000Hz）に雑音を通した音の LPC の包絡が、1000Hz 付近で山になること
    #[test]
    fn finds_resonance() {
        let sr = 10000.0f32;
        let (f, bw) = (1000.0f32, 100.0f32);
        let r = (-std::f32::consts::PI * bw / sr).exp();
        let c = 2.0 * r * (2.0 * std::f32::consts::PI * f / sr).cos();
        let mut seed = 1u32;
        let (mut y1, mut y2) = (0.0f32, 0.0f32);
        let x: Vec<f32> = (0..4000)
            .map(|_| {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let e = (seed >> 9) as f32 / (1u32 << 23) as f32 - 0.5;
                let y = e + c * y1 - r * r * y2;
                y2 = y1;
                y1 = y;
                y
            })
            .collect();
        let (a, _) = lpc(&x, 4).unwrap();
        let env = envelope(&a, 501);
        let peak = (0..env.len()).max_by(|&i, &j| env[i].total_cmp(&env[j])).unwrap();
        let hz = peak as f32 / 500.0 * sr / 2.0;
        assert!((hz - f).abs() < 50.0, "peak at {hz}Hz");
    }

    /// 全極フィルターを、分けて呼んでも一度に呼んでも同じ結果になること
    #[test]
    fn synthesize_continues() {
        let a = [1.0, -0.5, 0.2];
        let x: Vec<f32> = (0..20).map(|i| if i == 0 { 1.0 } else { 0.0 }).collect();
        let mut whole = vec![0.0; 20];
        synthesize(&a, &x, &mut [0.0; 2], &mut whole);
        let mut parts = vec![0.0; 20];
        let mut st = [0.0; 2];
        let (l, r) = parts.split_at_mut(7);
        synthesize(&a, &x[..7], &mut st, l);
        synthesize(&a, &x[7..], &mut st, r);
        assert_eq!(whole, parts);
    }
}

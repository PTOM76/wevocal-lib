//! 窓付き sinc 補間によるリサンプル。

use std::f64::consts::PI;

/// `x` を `ratio` 刻みで読み出す（ratio > 1 でピッチが上がる）。窓付き sinc 補間で、
/// 間引き時はカットオフをナイキスト未満に下げて折り返しを防ぐ。
pub fn resample(x: &[f32], ratio: f64, out_len: usize) -> Vec<f32> {
    resample_with(x, out_len, ratio, &|j| j as f64 * ratio)
}

/// 出力サンプル j を入力位置 `pos(j)` から読み出す。`max_step` は読み出し間隔の最大値で、
/// 1 を超える場合はカットオフを 1 / max_step に下げて折り返しを防ぐ。
pub fn resample_with(
    x: &[f32],
    out_len: usize,
    max_step: f64,
    pos: &dyn Fn(usize) -> f64,
) -> Vec<f32> {
    const HALF: usize = 16;
    let ratio = max_step;
    const PHASES: usize = 256;
    let cutoff = if ratio > 1.0 { 1.0 / ratio } else { 1.0 };
    let half = (HALF as f64 / cutoff).ceil() as usize;
    let taps = 2 * half;

    // カーネル表: p 行目は小数オフセット p/PHASES に対する正規化済みタップ係数。
    let table: Vec<f32> = (0..=PHASES)
        .flat_map(|p| {
            let frac = p as f64 / PHASES as f64;
            let row: Vec<f64> = (0..taps)
                .map(|k| {
                    let d = frac + half as f64 - 1.0 - k as f64;
                    let u = d / half as f64;
                    if u.abs() >= 1.0 {
                        return 0.0;
                    }
                    let arg = PI * d * cutoff;
                    let sinc = if arg.abs() < 1e-9 {
                        1.0
                    } else {
                        arg.sin() / arg
                    };
                    sinc * (0.5 + 0.5 * (PI * u).cos())
                })
                .collect();
            let norm: f64 = row.iter().sum();
            row.into_iter().map(move |k| (k / norm) as f32)
        })
        .collect();

    // 入力をゼロ詰めし、どのタップ窓も単純なスライスで取れるようにする。
    let mut padded = vec![0.0f32; x.len() + 2 * taps + 2];
    padded[half..half + x.len()].copy_from_slice(x);
    let max_center = x.len() + taps;

    (0..out_len)
        .map(|j| {
            let t = pos(j).max(0.0);
            let center = (t.floor() as usize).min(max_center);
            let pf = (t - t.floor()) * PHASES as f64;
            let p = (pf as usize).min(PHASES - 1);
            let g = (pf - p as f64) as f32;
            // タップは入力インデックス center-half+1 ..= center+half、つまり padded[center+1 ..] に対応する。
            let src = &padded[center + 1..center + 1 + taps];
            let (r0, r1) = (
                &table[p * taps..(p + 1) * taps],
                &table[(p + 1) * taps..(p + 2) * taps],
            );
            src.iter()
                .zip(r0.iter().zip(r1))
                .map(|(&v, (&a, &b))| v * (a + (b - a) * g))
                .sum()
        })
        .collect()
}

//! YIN 法による基本周波数（F0）推定。
//!
//! 計算量を抑えるため 16kHz に間引いてから、10ms ごとに推定する。
//! 無声・無音のフレームは 0 を返す。

use crate::resample;

/// 解析用のサンプルレート。
const ANALYSIS_RATE: f32 = 16000.0;
/// 推定する間隔（秒）。
pub const HOP_SEC: f32 = 0.01;
/// 差分関数を積分する窓長（秒）。
const WINDOW_SEC: f32 = 0.025;
/// 累積平均正規化差分がこの値を下回った最初の谷を周期とみなす。
const THRESHOLD: f32 = 0.15;
/// 探せる一番低い F0（Hz）。窓長（25ms）で周期を1つ以上含められる下限
const LOWEST_HZ: f32 = 40.0;

/// 解析の設定（設定画面の「ピッチ解析」から変えられる）
#[derive(Clone, Copy, Debug)]
pub struct Params {
    /// 探す F0 の範囲（Hz）
    pub min_hz: f32,
    pub max_hz: f32,
    /// 谷の深さ（累積平均正規化差分）がこれより浅いフレームは無声とする。大きいほどゆるい
    pub voiced_limit: f32,
    /// これより小さい音量（RMS）のフレームは無音とする
    pub silence_rms: f32,
}

impl Default for Params {
    fn default() -> Self {
        // 無音判定の 0.003 は約 -50dB
        Params { min_hz: 60.0, max_hz: 1000.0, voiced_limit: 0.35, silence_rms: 0.003 }
    }
}

/// モノラル信号 `x` の F0 を `HOP_SEC` 間隔で推定する。k 番目の値は時刻 k × HOP_SEC の推定値（Hz、無声は 0）。
pub fn estimate(x: &[f32], sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<f32> {
    estimate_with(x, sample_rate, &Params::default(), progress)
}

/// 設定 `p` で F0 を推定する（`estimate` 参照）
pub fn estimate_with(x: &[f32], sample_rate: f32, p: &Params, progress: &mut dyn FnMut(f64)) -> Vec<f32> {
    if x.is_empty() {
        return Vec::new();
    }
    let ratio = (sample_rate / ANALYSIS_RATE) as f64;
    let ds_len = (x.len() as f64 / ratio).round() as usize;
    let y = if (ratio - 1.0).abs() < 1e-9 {
        x.to_vec()
    } else {
        resample(x, ratio, ds_len)
    };

    let sr = ANALYSIS_RATE;
    let hop = (sr * HOP_SEC) as usize;
    let w = (sr * WINDOW_SEC) as usize;
    // 解析のサンプルレートで表せる範囲に収める（上限はナイキストの 1/4 まで）
    let min_hz = p.min_hz.max(LOWEST_HZ);
    let max_hz = p.max_hz.clamp(min_hz * 1.5, sr / 4.0);
    let tau_min = ((sr / max_hz) as usize).max(2);
    let tau_max = (sr / min_hz) as usize;
    let frames = y.len() / hop + 1;

    // フレーム中心を時刻に合わせるため、前後をゼロ詰めする。
    let pad = w / 2 + tau_max + 1;
    let mut buf = vec![0.0f32; pad + y.len() + pad + w];
    buf[pad..pad + y.len()].copy_from_slice(&y);

    let mut d = vec![0.0f32; tau_max + 2];
    let mut out = Vec::with_capacity(frames);
    for k in 0..frames {
        if k % 500 == 0 {
            progress(k as f64 / frames as f64);
        }
        let start = pad + k * hop - w / 2;
        let frame = &buf[start..start + w + tau_max + 1];

        let energy: f32 = frame[..w].iter().map(|v| v * v).sum();
        if (energy / w as f32).sqrt() < p.silence_rms {
            out.push(0.0);
            continue;
        }

        // 差分関数 d(τ) と累積平均正規化差分 d'(τ)。
        d[0] = 1.0;
        let mut running = 0.0f32;
        for tau in 1..=tau_max {
            let s = sq_diff_sum(&frame[..w], &frame[tau..tau + w]);
            running += s;
            d[tau] = if running > 0.0 {
                s * tau as f32 / running
            } else {
                1.0
            };
        }

        // 閾値を下回った最初の谷を採用し、なければ全体の最小値を候補にする。
        let mut best = None;
        let mut tau = tau_min;
        while tau < tau_max {
            if d[tau] < THRESHOLD {
                while tau + 1 < tau_max && d[tau + 1] < d[tau] {
                    tau += 1;
                }
                best = Some(tau);
                break;
            }
            tau += 1;
        }
        let tau = best.unwrap_or_else(|| {
            (tau_min..tau_max)
                .min_by(|&a, &b| d[a].total_cmp(&d[b]))
                .unwrap_or(tau_min)
        });
        if d[tau] > p.voiced_limit {
            out.push(0.0);
            continue;
        }

        // 放物線補間で周期を小数精度にする。
        let (a, b, c) = (d[tau - 1], d[tau], d[tau + 1]);
        let denom = a - 2.0 * b + c;
        let shift = if denom.abs() > 1e-12 {
            0.5 * (a - c) / denom
        } else {
            0.0
        };
        out.push(sr / (tau as f32 + shift.clamp(-1.0, 1.0)));
    }
    progress(1.0);
    out
}

/// Σ(a[i] - b[i])²。8本の部分和に分けて足し込み、コンパイラが SIMD 命令に変換できるようにする
/// （1本の足し込みだと浮動小数点の加算順序を変えられず、ベクトル化されない）。
fn sq_diff_sum(a: &[f32], b: &[f32]) -> f32 {
    let mut acc = [0.0f32; 8];
    let (ca, cb) = (a.chunks_exact(8), b.chunks_exact(8));
    let (ra, rb) = (ca.remainder(), cb.remainder());
    for (x, y) in ca.zip(cb) {
        for i in 0..8 {
            let d = x[i] - y[i];
            acc[i] += d * d;
        }
    }
    let mut s: f32 = acc.iter().sum();
    for (x, y) in ra.iter().zip(rb) {
        s += (x - y) * (x - y);
    }
    s
}

//! ピッチカーブ編集: 時間ごとに変わるピッチ比で、長さを変えずにピッチを変える。
//!
//! 一定のピッチ変更と同じく「伸縮 → リサンプル」で行う。入力の各時刻 t をピッチ比 r(t) 倍に
//! 伸ばし（中間信号の時刻 τ(t) = ∫r dt）、中間信号を位置 τ(t) から読み戻すことで、
//! 長さは元のまま、時刻 t のピッチだけが r(t) 倍になる。

use crate::{formant, resample_with, Algorithm, Formant, TimeMap};

/// 1フレームで許容するピッチ比の範囲（±24半音）。
const MIN_RATIO: f32 = 0.25;
const MAX_RATIO: f32 = 4.0;

/// `ratios[k]` は時刻 k × `hop`（サンプル）のピッチ比。間は線形補間し、範囲外は端の値を使う。
pub fn process(
    channels: &[&[f32]],
    sample_rate: f32,
    ratios: &[f32],
    hop: f64,
    algorithm: Algorithm,
    formant: Formant,
    progress: &mut dyn FnMut(f64),
) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    let formant_ratio = match formant {
        Formant::Follow => None,
        Formant::Shift(st) => Some(2f64.powf(st / 12.0)),
    };
    let unchanged = ratios.iter().all(|&r| (r - 1.0).abs() < 1e-6);
    if len == 0
        || ratios.is_empty()
        || (unchanged && formant_ratio.is_none_or(|f| (f - 1.0).abs() < 1e-9))
    {
        return channels.iter().map(|c| c.to_vec()).collect();
    }

    let ratio_at = |i: f64| -> f64 {
        let k = (i / hop).max(0.0);
        let a = (k.floor() as usize).min(ratios.len() - 1);
        let b = (a + 1).min(ratios.len() - 1);
        let g = (k - k.floor()) as f32;
        (ratios[a] + (ratios[b] - ratios[a]) * g).clamp(MIN_RATIO, MAX_RATIO) as f64
    };

    // 中間信号上の位置 τ(i) = Σ r（i は入力サンプル位置）。
    let mut tau = Vec::with_capacity(len + 1);
    let mut acc = 0.0f64;
    let mut max_ratio = 1.0f64;
    tau.push(0.0);
    for i in 0..len {
        let r = ratio_at(i as f64);
        max_ratio = max_ratio.max(r);
        acc += r;
        tau.push(acc);
    }
    let z_len = acc.round().max(1.0) as usize;

    // τ → 入力位置（τ の逆関数）。τ は単調増加なので二分探索で求める。
    let to_input = |t: f64| -> f64 {
        let i = tau.partition_point(|&v| v <= t).clamp(1, len) - 1;
        let span = tau[i + 1] - tau[i];
        i as f64
            + if span > 0.0 {
                ((t - tau[i]) / span).clamp(0.0, 1.0)
            } else {
                0.0
            }
    };

    const STRETCH_SHARE: f64 = 0.6;
    let map = TimeMap::new(z_len, &to_input);
    let mut z = algorithm.stretch_map(channels, &map, sample_rate, &mut |p| {
        progress(p * STRETCH_SHARE)
    });

    let n = z.len().max(1) as f64;
    if let Some(f) = formant_ratio {
        // 中間信号の位置 → 元の時刻のピッチ比 → 包絡の変形率。
        let c_at = |zpos: usize| ratio_at(to_input(zpos as f64)) / f;
        for (i, c) in z.iter_mut().enumerate() {
            let base = STRETCH_SHARE + 0.2 * i as f64 / n;
            *c = formant::correct_varying(c, &c_at, sample_rate, &mut |p| {
                progress(base + 0.2 * p / n)
            });
        }
    }

    let out = z
        .iter()
        .enumerate()
        .map(|(i, c)| {
            progress(0.8 + 0.2 * i as f64 / n);
            resample_with(c, len, max_ratio, &|j| tau[j])
        })
        .collect();
    progress(1.0);
    out
}

//! 2乗誤差で区切り位置を探す、クロスフェード方式の時間伸縮（SOLA）。
//!
//! 約50msのブロックを切り貼りし、隣り合うブロックは短い区間だけ重ねてクロスフェードする。
//! 区切り位置は、重なる区間の2乗誤差が最小になる位置を探して波形の位相を揃える。
//! WSOLA（`wsola`）が 50% 重ねて相関で探すのに対し、重なりが短いため音のにじみが少ない。

use crate::TimeMap;
use std::f64::consts::PI;

/// ブロックの長さ（秒）。短いと低音が再現できず、長いとなめらかに聞こえない
const BLOCK_SEC: f32 = 0.05;
/// 隣のブロックと重ねてクロスフェードする長さ（秒）
const FADE_SEC: f32 = 0.01;
/// 区切り位置の探索幅（秒）。約83Hz までのピッチ周期1つ分をカバーする
const TOLERANCE_SEC: f32 = 0.012;

/// 全チャンネルを `alpha` 倍に時間伸縮する（出力長 = 入力長 × alpha）。
pub fn stretch(channels: &[&[f32]], alpha: f64, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    if (alpha - 1.0).abs() < 1e-9 {
        return channels.iter().map(|c| c.to_vec()).collect();
    }
    let out_len = (len as f64 * alpha).round() as usize;
    stretch_map(channels, &TimeMap::linear(len, out_len), sample_rate, progress)
}

/// 任意の時間対応 `map` で全チャンネルを伸縮する。
/// 全チャンネルで同じ区切り位置を使い、ステレオ定位を崩さない。
pub fn stretch_map(channels: &[&[f32]], map: &TimeMap, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    let out_len = map.out_len;
    if len == 0 || out_len == 0 {
        return vec![Vec::new(); channels.len()];
    }

    let hop = ((sample_rate * BLOCK_SEC) as usize).max(32);
    let fade = ((sample_rate * FADE_SEC) as usize).clamp(8, hop / 2);
    // 1ブロック = 前の重なり + 本体 + 次の重なり（前後のブロックと fade だけ重なる）
    let n = hop + fade;
    let delta = ((sample_rate * TOLERANCE_SEC) as i64).max(8);
    // 立ち上がりと立ち下がりは sin 形（足し合わせるとちょうど 1 になる）。間は 1
    let window: Vec<f32> = (0..n)
        .map(|i| {
            let ramp = |j: usize| (0.5 - 0.5 * (PI * (j as f64 + 0.5) / fade as f64).cos()) as f32;
            if i < fade {
                ramp(i)
            } else if i >= hop {
                1.0 - ramp(i - hop)
            } else {
                1.0
            }
        })
        .collect();

    // ゼロ詰めしたモノラルミックス（探索で境界チェックなしにスライスを使う）
    let pad_l = delta as usize + 8;
    let pad_r = n + delta as usize + 8;
    let mut mono = vec![0.0f32; pad_l + len + pad_r];
    for c in channels {
        for (m, &v) in mono[pad_l..pad_l + len].iter_mut().zip(c.iter()) {
            *m += v / channels.len() as f32;
        }
    }
    let seg = |p: i64| -> &[f32] {
        let s = (p.clamp(-(delta + 4), (len + delta as usize) as i64) + pad_l as i64) as usize;
        &mono[s..s + fade]
    };
    // 重なる区間の2乗誤差（小さいほど波形が似ている）
    let sq_err = |a: i64, b: i64, step: usize| -> f32 {
        seg(a).iter().step_by(step).zip(seg(b).iter().step_by(step)).map(|(x, y)| (x - y) * (x - y)).sum()
    };

    let mut out = vec![vec![0.0f32; out_len + n]; channels.len()];
    let mut wsum = vec![0.0f32; out_len + n];
    let frames = out_len / hop + 1;
    let last_pos = len.saturating_sub(n) as i64;
    let clamp_pos = |p: i64| p.clamp(0, last_pos);
    let mut prev_pos: i64 = 0;

    for k in 0..frames {
        if k % 256 == 0 {
            progress(k as f64 / frames as f64);
        }
        let out_start = k * hop;
        let pos = if k == 0 {
            0
        } else {
            let nominal = map.frame_pos(out_start, len, n).round() as i64;
            // 前のブロックの続き（このブロックとクロスフェードする区間）
            let natural = prev_pos + hop as i64;
            let (mut best, mut best_e) = (clamp_pos(nominal), f32::MAX);
            let mut off = -delta;
            while off <= delta {
                let cand = clamp_pos(nominal + off);
                let e = sq_err(natural, cand, 4);
                if e < best_e {
                    best_e = e;
                    best = cand;
                }
                off += 2;
            }
            let coarse = best;
            best_e = f32::MAX;
            for off in -2..=2 {
                let cand = clamp_pos(coarse + off);
                let e = sq_err(natural, cand, 1);
                if e < best_e {
                    best_e = e;
                    best = cand;
                }
            }
            best
        };
        prev_pos = pos;

        for i in 0..n {
            let src = pos + i as i64;
            let w = window[i];
            wsum[out_start + i] += w;
            if src >= 0 && (src as usize) < len {
                for (o, c) in out.iter_mut().zip(channels) {
                    o[out_start + i] += w * c[src as usize];
                }
            }
        }
    }

    for o in out.iter_mut() {
        o.truncate(out_len);
        for (s, &w) in o.iter_mut().zip(&wsum) {
            *s = if w > 1e-3 { *s / w } else { 0.0 };
        }
    }
    out
}

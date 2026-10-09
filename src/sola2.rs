//! SOLA の改良版（SOLAv2）。声のある所は、切り貼りの単位を声の 1 周期にし、近くの周期と混ぜて少しずつ移り変わらせる。
//!
//! SOLA は約50msのブロックを繰り返すので、ブロックの中の立ち上がりや揺れがまとめて二重になり、
//! 大きく伸ばすとガサガサする。ここでは声のある所のブロックを 1 周期にし、つなぎ方は SOLA と同じく
//! 短いクロスフェードと2乗誤差での位置合わせにする。声のない所は `Params::unvoiced` の固定長。
//! 数周期をまとめて繰り返すと、その長さの周期で低いうなりが出る（2 周期で試して悪化した）ため 1 周期にしている。
//!
//! SOLAv3（`stretch_clean`）は混ぜる周期の広さ（`spread`）を広げ、前後数周期の平均で周期ごとの揺らぎや息のノイズが打ち消し合い、
//! 原音より整った（周期的で滑らかな）声になる。元の声らしさを残す SOLAv2 と、選んで使い分ける。

use crate::{f0, TimeMap};
use std::f64::consts::PI;

/// 調整できる値（秒・周期数）。テスト（`tests/sola_params.rs`）で組み合わせを比べて決めた
#[derive(Clone, Copy, Debug)]
pub struct Params {
    /// 混ぜる周期の広さ（周期数）。SOLAv2 は隣の周期との直線補間（1）、SOLAv3 は前後約 3 周期の三角の重み
    pub spread: f64,
    /// 声のない所のブロックの長さ
    pub unvoiced: f64,
    /// クロスフェードの最大の長さ。ブロックの半分も超えない
    pub fade: f64,
    /// 声のない所の探索幅
    pub tolerance: f64,
    /// 立ち上がり（破裂音など）を等速で読む長さ。この間は繰り返さない
    pub transient: f64,
}

pub const PARAMS: Params = Params { spread: 1.0, unvoiced: 0.012, fade: 0.005, tolerance: 0.006, transient: 0.015 };
pub const PARAMS_CLEAN: Params = Params { spread: 3.0, ..PARAMS };

/// 全チャンネルを `alpha` 倍に時間伸縮する（出力長 = 入力長 × alpha）。
pub fn stretch(channels: &[&[f32]], alpha: f64, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    stretch_with(channels, alpha, sample_rate, &PARAMS, progress)
}

/// 任意の時間対応 `map` で全チャンネルを伸縮する。全チャンネルで同じ区切り位置を使う。
pub fn stretch_map(channels: &[&[f32]], map: &TimeMap, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    run(channels, map, sample_rate, &PARAMS, progress)
}

/// SOLAv3（前後数周期を平均する）。
pub fn stretch_clean(channels: &[&[f32]], alpha: f64, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    stretch_with(channels, alpha, sample_rate, &PARAMS_CLEAN, progress)
}

/// SOLAv3 の、任意の時間対応での伸縮。
pub fn stretch_map_clean(channels: &[&[f32]], map: &TimeMap, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    run(channels, map, sample_rate, &PARAMS_CLEAN, progress)
}

pub fn stretch_with(channels: &[&[f32]], alpha: f64, sample_rate: f32, p: &Params, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    // SOLAv3 は等倍でも平均をかける（等倍で何もしないと、伸縮しない部分だけ整わない）
    if (alpha - 1.0).abs() < 1e-9 && p.spread <= PARAMS.spread {
        return channels.iter().map(|c| c.to_vec()).collect();
    }
    let out_len = (len as f64 * alpha).round() as usize;
    run(channels, &TimeMap::linear(len, out_len), sample_rate, p, progress)
}
fn run(channels: &[&[f32]], map: &TimeMap, sample_rate: f32, p: &Params, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    let out_len = map.out_len;
    if len == 0 || out_len == 0 {
        return vec![Vec::new(); channels.len()];
    }
    let sr = sample_rate as f64;
    let mono: Vec<f32> = (0..len).map(|i| channels.iter().map(|c| c[i]).sum::<f32>() / channels.len() as f32).collect();
    let f0s = f0::estimate(&mono, sample_rate, &mut |p| progress(p * 0.4));
    let f0_hop = sr * f0::HOP_SEC as f64;
    // 入力位置の周期（サンプル）。声がなければ None
    let period_at = |i: i64| {
        let f = f0s.get(((i.max(0) as f64 / f0_hop).round() as usize).min(f0s.len().saturating_sub(1))).copied().unwrap_or(0.0);
        (f > 0.0).then(|| sr / f as f64)
    };
    let onsets = onsets(&mono, sample_rate);
    let transient = (sr * p.transient) as i64;
    let max_fade = (sr * p.fade) as usize;
    let max_block = (sr * 0.05) as usize + max_fade;
    let typical = (sr * p.unvoiced) as usize + max_fade;
    let last_pos = len.saturating_sub(typical) as i64;
    let pad = max_block + 8;
    let mut padded = vec![0.0f32; pad + len + pad];
    padded[pad..pad + len].copy_from_slice(&mono);
    // 位置 `p` から `n` サンプル（範囲外は 0）
    let seg = |p: i64, n: usize| -> &[f32] {
        let s = (p.clamp(-(pad as i64) + 1, (len + 1) as i64) + pad as i64) as usize;
        &padded[s..s + n]
    };
    let sq_err = |a: i64, b: i64, n: usize| -> f32 { seg(a, n).iter().zip(seg(b, n)).map(|(x, y)| (x - y) * (x - y)).sum() };
    let at = |c: &[f32], p: i64| if p >= 0 && (p as usize) < len { c[p as usize] } else { 0.0 };
    // `from` から 1 周期（`t`）進めた・戻した位置を、中心の周期（`center`）の 1 周期分の波形と最も似ている所にそろえる。
    // 隣どうしでそろえると、外側の周期ほどずれがたまり、重ねたときにうなり（震え）になる。入力に収まらなければ None
    let neighbor = |from: i64, center: i64, t: i64, dir: i64| {
        let guess = from + dir * t;
        if guess - t / 4 < 0 || guess + t / 4 > last_pos {
            return None;
        }
        let mut best = (guess, f32::MAX);
        for cand in guess - t / 4..=guess + t / 4 {
            let e = sq_err(center, cand, t as usize);
            if e < best.1 {
                best = (cand, e);
            }
        }
        Some(best.0)
    };

    let mut out = vec![vec![0.0f32; out_len + max_block]; channels.len()];
    let mut wsum = vec![0.0f32; out_len + max_block];
    let ramp = |j: usize, f: usize| (0.5 - 0.5 * (PI * (j as f64 + 0.5) / f as f64).cos()) as f32;
    let (mut out_pos, mut prev_end): (usize, i64) = (0, 0);
    let mut prev_fade = 0usize;
    let (mut prev_nominal, mut reversed) = (0i64, false);
    // 立ち上がりを読み終える入力位置。ここまでは前のブロックの続きを読み、ここより前には戻らない（破裂が二重にならないように）
    let mut lock = -1i64;
    // 混ぜる周期（入力位置と重み）。ブロックごとに作り直す
    let mut taps: Vec<(i64, f32)> = Vec::new();
    while out_pos < out_len {
        progress(0.4 + 0.6 * out_pos as f64 / out_len as f64);
        // 末尾で行き過ぎないよう、最後のブロックが入力の最後に来る対応にする（`TimeMap::frame_pos` 参照）
        let nominal = map.frame_pos(out_pos, len, typical).round() as i64;
        // ブロックの長さと探索幅: 声があれば 1 周期と ±半周期、なければ固定長
        let period = period_at(nominal);
        let voiced = period.is_some();
        let (hop, delta) = match period {
            Some(t) => (t.round() as usize, (t / 2.0).ceil() as i64),
            None => ((sr * p.unvoiced) as usize, (sr * p.tolerance) as i64),
        };
        let hop = hop.clamp(16, max_block - max_fade);
        let fade = max_fade.min(hop / 2).max(4);
        // 声のない所で同じ断片を繰り返す（入力の進みがブロックより短い）ときは、1 回おきに逆向きに読む。
        // 同じ雑音を同じ向きで繰り返すと、ブロックの長さの周期で音程のある雑音になるため（Moulines & Charpentier 1990）
        let mut repeating = !voiced && out_pos > 0 && ((nominal - prev_nominal) as f64) < hop as f64 * 0.9;
        prev_nominal = nominal;
        // 声のない所の立ち上がり（破裂音など）は 1 回だけ等速で読む。繰り返すと二重に聞こえる
        // - 読み終えるまでは前のブロックの続きを読む
        // - 予定の時刻（nominal）が立ち上がりに届いたブロックで、立ち上がりの少し手前から読み始める
        // - 届く前のブロックは、立ち上がりの手前で切れる位置から読む（早く鳴らない）
        // - 読み終えたあとは、立ち上がりより前に戻らない
        let continuing = !voiced && out_pos > 0 && prev_end < lock;
        // まだ鳴らしていない立ち上がり。予定の時刻がすでに通り過ぎたもの（声のある所として読んだものなど）は数えない
        let next_onset = onsets.iter().copied().find(|&o| o >= lock.max(0) && o + hop as i64 > nominal);
        let mut starts = false;
        if !voiced && out_pos > 0 && !continuing {
            // このブロックで始めたときの、予定の時刻とのずれ（出力のサンプル）。次のブロックで始めるより近ければ始める
            let rate = ((map.frame_pos(out_pos + hop, len, typical).round() as i64 - nominal).max(1)) as f64 / hop as f64;
            if let Some(o) = next_onset.filter(|&o| o < nominal + hop as i64 && fade as f64 - (o - nominal) as f64 / rate >= -(hop as f64) / 2.0) {
                lock = o + transient;
                starts = true;
            }
        }
        if continuing || starts {
            repeating = false;
        }
        reversed = repeating && !reversed;
        // 前のブロックの続き（前のブロックの終わりのクロスフェード区間）と最も似ている位置。
        // 声のない所を繰り返すときは雑音なので位置合わせはしない
        let mut pos = if out_pos == 0 {
            0
        } else if continuing {
            prev_end.clamp(0, last_pos)
        } else if starts {
            (lock - transient - fade as i64).clamp(0, last_pos)
        } else if repeating {
            nominal.clamp(0, last_pos)
        } else {
            let natural = prev_end;
            let f = prev_fade.min(fade).max(4);
            let mut best = (nominal, f32::MAX);
            for off in -delta..=delta {
                let cand = (nominal + off).clamp(0, last_pos);
                let e = sq_err(natural, cand, f);
                if e < best.1 {
                    best = (cand, e);
                }
            }
            best.0
        };
        if !voiced && out_pos > 0 && !continuing && !starts {
            // 読み終えた立ち上がりより前に戻らない
            if lock > 0 && pos < lock {
                pos = lock.min(last_pos);
            }
            // まだ鳴らしていない立ち上がりを、このブロックで先に鳴らさない
            if let Some(o) = next_onset.filter(|&o| o > pos && o < pos + (hop + fade) as i64) {
                pos = (o - (hop + fade) as i64).max(0).min(pos);
            }
        }        // 声のある所は、予定位置（選んだ周期から frac 周期ずれた所）を中心に、近くの周期を三角の重みで混ぜる。
        // 同じ周期を何度か繰り返してから次の周期へ飛ぶと、その飛び目が周期数個おきのブツブツになるため（波形補間の考え方）。
        // 隣の周期が入力に収まらない（先頭・末尾）方向は混ぜない。切り詰めた位置と混ぜると打ち消し合う
        taps.clear();
        taps.push((pos, 1.0));
        if voiced && out_pos > 0 {
            let t = hop as i64;
            let frac = ((nominal - pos) as f64 / t as f64).clamp(-1.0, 1.0);
            let weight = |k: i64| (1.0 - (k as f64 - frac).abs() / p.spread).max(0.0) as f32;
            taps[0].1 = weight(0);
            for dir in [-1i64, 1] {
                let mut p = pos;
                for k in 1.. {
                    let w = weight(dir * k);
                    if w <= 0.0 {
                        break;
                    }
                    match neighbor(p, pos, t, dir) {
                        Some(q) => p = q,
                        None => break,
                    }
                    taps.push((p, w));
                }
            }
        }
        // 重みの寄る側の周期が入力に収まらない（末尾）と合計が 0 になるので、選んだ周期をそのまま使う
        if taps.iter().map(|t| t.1).sum::<f32>() <= 1e-6 {
            taps.truncate(1);
            taps[0].1 = 1.0;
        }
        let total: f32 = taps.iter().map(|t| t.1).sum();
        // 1ブロック = 前の重なり（fade）+ 本体（hop - fade）+ 次の重なり（fade）
        let n = hop + fade;
        for i in 0..n {
            let o = out_pos + i;
            if o >= wsum.len() {
                break;
            }
            let w = if i < prev_fade.min(fade) && out_pos > 0 {
                ramp(i, prev_fade.min(fade))
            } else if i >= hop {
                1.0 - ramp(i - hop, fade)
            } else {
                1.0
            };
            wsum[o] += w;
            for (oc, c) in out.iter_mut().zip(channels) {
                let v = if reversed {
                    at(c, pos + (n - 1 - i) as i64)
                } else {
                    taps.iter().map(|&(p, tw)| tw * at(c, p + i as i64)).sum::<f32>() / total
                };
                oc[o] += w * v;
            }
        }
        prev_end = pos + hop as i64;
        prev_fade = fade;
        out_pos += hop;
    }
    for o in out.iter_mut() {
        o.truncate(out_len);
        for (s, &w) in o.iter_mut().zip(&wsum) {
            *s = if w > 1e-3 { *s / w } else { 0.0 };
        }
    }
    out
}

/// 立ち上がり（破裂音など）の検出は WeVocalLib に移した（ほかのソフトでも使えるように）
pub use crate::onset::energy_onsets as onsets;

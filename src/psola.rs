//! TD-PSOLA（Time-Domain Pitch-Synchronous Overlap-Add）による時間伸縮。ボーカル向け。
//!
//! 声の周期（ピッチ）に合わせて1周期ごとに目印（ピッチマーク）を置き、目印を中心に2周期分を切り出して
//! 1周期ずつずらして重ね合わせる。伸ばすときは同じ周期を繰り返し、縮めるときは間引く。
//! WSOLA は約46ms の断片を「似ている位置」で重ねるため、断片の境目が声の周期とずれると
//! ぼやけやうなりが出る。PSOLA は周期の区切りで切り貼りするので、伸ばしても声の周期構造が崩れにくい。
//!
//! 息や子音など周期のない部分は一定間隔で切り出し、同じ断片の繰り返しがブザー音にならないよう、
//! 切り出す位置を少しずつランダムにずらす。

use crate::{f0, TimeMap};
use std::f64::consts::PI;

/// 周期のない部分で切り出す間隔（秒）
const UNVOICED_PERIOD_SEC: f64 = 0.005;
/// 目印を探す範囲（周期に対する割合）。前の目印から1周期先の前後で、波形の山を探す
const SEARCH_RATIO: f64 = 0.3;
/// 重ね合わせた窓の合計がこれより小さいところは、割り算で音が大きくなりすぎないようにする
const MIN_WINDOW_SUM: f32 = 0.3;

/// 1つの目印。`period` はその位置の周期（サンプル）
struct Mark {
    pos: f64,
    period: f64,
    voiced: bool,
}

/// 目印の置き方
#[derive(Clone, Copy, PartialEq)]
pub enum Marking {
    /// 予定位置の前後で最も大きいサンプル（従来）
    Peak,
    /// 前の周期の波形と最も似ている位置（正規化した相互相関。PSOLA 2）。
    /// 1周期の中に同じくらいの山が複数あると、最大の山は周期ごとに入れ替わり、切り出す位相がずれてかすれた音になる。
    /// 前の周期との相関で決めると、周期ごとに同じ位相の位置にそろう
    Correlation,
}

/// 全チャンネルを `alpha` 倍に時間伸縮する（出力長 = 入力長 × alpha）。
pub fn stretch(channels: &[&[f32]], alpha: f64, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    stretch_with(channels, alpha, sample_rate, Marking::Peak, progress)
}

/// 目印の置き方を選べる `stretch`
pub fn stretch_with(channels: &[&[f32]], alpha: f64, sample_rate: f32, marking: Marking, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    if (alpha - 1.0).abs() < 1e-9 {
        return channels.iter().map(|c| c.to_vec()).collect();
    }
    let out_len = (len as f64 * alpha).round() as usize;
    stretch_map_with(channels, &TimeMap::linear(len, out_len), sample_rate, marking, progress)
}

/// 任意の時間対応 `map` で全チャンネルを伸縮する。
pub fn stretch_map(channels: &[&[f32]], map: &TimeMap, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    stretch_map_with(channels, map, sample_rate, Marking::Peak, progress)
}

/// 目印の置き方を選べる `stretch_map`
pub fn stretch_map_with(channels: &[&[f32]], map: &TimeMap, sample_rate: f32, marking: Marking, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    let out_len = map.out_len;
    if len == 0 || out_len == 0 {
        return vec![Vec::new(); channels.len()];
    }
    // 目印はモノラルにまとめた信号で決め、全チャンネルで共有する（ステレオの定位を崩さないため）
    let mono: Vec<f32> = (0..len)
        .map(|i| channels.iter().map(|c| c[i]).sum::<f32>() / channels.len() as f32)
        .collect();
    let f0s = f0::estimate(&mono, sample_rate, &mut |p| progress(p * 0.4));
    let marks = pitch_marks(&mono, &f0s, sample_rate as f64, marking);
    progress(0.5);

    let mut out = vec![vec![0.0f32; out_len]; channels.len()];
    let mut wsum = vec![0.0f32; out_len];
    // 周期のない部分の揺らぎ用の簡単な乱数（結果を毎回同じにするため種は固定）
    let mut seed: u32 = 0x1234_5678;
    let mut rand = move || {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (seed >> 8) as f64 / (1u32 << 24) as f64 - 0.5
    };

    // PSOLA 2 は、声のない所の立ち上がり（破裂音など）を 1 回だけ等速で読む（SOLAv2 と同じ。5ms ごとに切り出すと、伸ばしたときに二重になる）
    let onsets: Vec<f64> = if marking == Marking::Correlation { crate::sola2::onsets(&mono, sample_rate).into_iter().map(|o| o as f64).collect() } else { Vec::new() };
    let transient = sample_rate as f64 * crate::sola2::PARAMS.transient;
    // 次に鳴らす立ち上がりの番号、等速で読んでいる立ち上がり（入力の位置と、始めた出力の位置）、これより前には戻らない入力の位置
    let (mut next, mut lock, mut floor) = (0usize, None::<(f64, f64)>, 0.0f64);

    let mut tau = 0.0f64;
    let mut step = 0usize;
    while tau < out_len as f64 {
        let t = map.input_at(tau).clamp(0.0, (len - 1) as f64);
        let m = &marks[nearest(&marks, t)];
        // 声のある部分は目印の位置から、ない部分は対応する位置の近くから切り出す
        let mut center = if m.voiced { m.pos } else { t + rand() * m.period };
        if !m.voiced && !onsets.is_empty() {
            if let Some((o, tau0)) = lock {
                let c = o + (tau - tau0);
                if c < o + transient {
                    center = c;
                } else {
                    lock = None;
                    floor = o + transient;
                }
            }
            if lock.is_none() {
                // 読み終えたものと、予定の時刻を通り過ぎたもの（声のある所として読んだものなど）は数えない
                while next < onsets.len() && (onsets[next] < floor || onsets[next] + m.period < t) {
                    next += 1;
                }
                match onsets.get(next) {
                    // 予定の時刻が届いたら、立ち上がりから等速で読み始める
                    Some(&o) if t >= o - m.period / 2.0 => {
                        lock = Some((o, tau));
                        next += 1;
                        center = o;
                    }
                    // 届く前は、立ち上がりにかからない所から切り出す（先に鳴らさない）
                    Some(&o) if center + m.period > o => center = o - m.period,
                    _ => {}
                }
                // 読み終えた立ち上がりより前に戻らない（同じ所を繰り返すとブザー音になるので、少しずらす）
                if lock.is_none() && center < floor {
                    center = floor + (rand() + 0.5) * m.period;
                }
            }
        }
        overlap_add(channels, &mut out, &mut wsum, center, tau, m.period);
        tau += m.period;
        step += 1;
        if step % 2048 == 0 {
            progress(0.5 + 0.5 * tau / out_len as f64);
        }
    }

    for o in out.iter_mut() {
        for (s, &w) in o.iter_mut().zip(&wsum) {
            *s /= w.max(MIN_WINDOW_SUM);
        }
    }
    progress(1.0);
    out
}

/// 入力の `center` を中心に2周期分を Hann 窓で切り出し、出力の `at` を中心に足し込む
fn overlap_add(channels: &[&[f32]], out: &mut [Vec<f32>], wsum: &mut [f32], center: f64, at: f64, period: f64) {
    let len = channels[0].len() as i64;
    let out_len = wsum.len() as i64;
    let half = period.round().max(1.0) as i64;
    let (src0, dst0) = (center.round() as i64, at.round() as i64);
    for d in -half..=half {
        let (src, dst) = (src0 + d, dst0 + d);
        if dst < 0 || dst >= out_len || src < 0 || src >= len {
            continue;
        }
        let w = (0.5 + 0.5 * (PI * d as f64 / half as f64).cos()) as f32;
        wsum[dst as usize] += w;
        for (o, c) in out.iter_mut().zip(channels) {
            o[dst as usize] += w * c[src as usize];
        }
    }
}

/// 目印を先頭から順に置く。声のある部分は前の目印から約1周期先の波形の山、ない部分は一定間隔
fn pitch_marks(x: &[f32], f0s: &[f32], sr: f64, marking: Marking) -> Vec<Mark> {
    let hop = sr * f0::HOP_SEC as f64;
    let unvoiced = sr * UNVOICED_PERIOD_SEC;
    let period_at = |i: f64| {
        let f = f0s[((i / hop).round() as usize).min(f0s.len() - 1)];
        (f > 0.0).then(|| sr / f as f64)
    };
    let mut marks = Vec::new();
    let mut i = 0.0f64;
    while i < x.len() as f64 {
        match period_at(i) {
            Some(p) => {
                // 予定位置の前後で最も大きい山を目印にする（周期ごとに同じ位相で切り出すため）
                let lo = (i - p * SEARCH_RATIO).max(0.0) as usize;
                let hi = ((i + p * SEARCH_RATIO) as usize).min(x.len() - 1);
                let prev_voiced = marks.last().filter(|m: &&Mark| m.voiced).map(|m| m.pos);
                let peak = match (marking, prev_voiced) {
                    // 声の続きは、前の目印のまわり1周期分と最も似ている位置
                    (Marking::Correlation, Some(prev)) => best_match(x, prev as usize, p, lo, hi).unwrap_or(i as usize) as f64,
                    // 声の始まり（と従来の方式）は最も大きい山
                    _ => (lo..=hi).max_by(|&a, &b| x[a].total_cmp(&x[b])).unwrap_or(i as usize) as f64,
                };
                // 前の目印に近づきすぎたら、予定位置を使う
                let pos = match marks.last() {
                    Some(Mark { pos, .. }) if peak - pos < p * 0.5 => i,
                    _ => peak,
                };
                marks.push(Mark { pos, period: p, voiced: true });
                i = pos + p;
            }
            None => {
                marks.push(Mark { pos: i, period: unvoiced, voiced: false });
                i += unvoiced;
            }
        }
    }
    marks
}

/// `prev` を中心にした1周期分の波形と、`lo..=hi` の各位置を中心にした波形の正規化相互相関が最大になる位置
fn best_match(x: &[f32], prev: usize, p: f64, lo: usize, hi: usize) -> Option<usize> {
    let half = (p / 2.0).round().max(1.0) as usize;
    if prev < half || prev + half >= x.len() {
        return None;
    }
    let reference = &x[prev - half..prev + half];
    let mut best: Option<(usize, f32)> = None;
    for c in lo.max(half)..=hi.min(x.len().saturating_sub(half + 1)) {
        let cand = &x[c - half..c + half];
        let (mut dot, mut e) = (0.0f32, 0.0f32);
        for (a, b) in reference.iter().zip(cand) {
            dot += a * b;
            e += b * b;
        }
        let score = dot / (e.sqrt() + 1e-9);
        if best.is_none_or(|(_, s)| score > s) {
            best = Some((c, score));
        }
    }
    best.map(|(c, _)| c)
}

/// `t` に最も近い目印の番号
fn nearest(marks: &[Mark], t: f64) -> usize {
    let i = marks.partition_point(|m| m.pos < t);
    if i == 0 {
        0
    } else if i >= marks.len() || t - marks[i - 1].pos <= marks[i].pos - t {
        i - 1
    } else {
        i
    }
}

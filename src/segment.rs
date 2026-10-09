//! 区間に分けて並列に加工する（試験的。memo の WebGPU の設計の 9.）。
//!
//! 音を `SEG_SEC` ずつの区間に分け、前後に `MARGIN_SEC` の余白を付けて区間ごとに別々に加工し、境目をつなぐ。
//! 区間どうしは独立しているので、別々の Worker（ネイティブではスレッド）で同時に処理できる。
//! 境目は、隣の区間と重なった所のうち、2 つの出力の波形が最も似ている所を選び、短いクロスフェードでつなぐ。
//! 波形の位相を合わせるため、次の区間を最大 5ms ずらして読む（全体の長さは変わらない）。今はピッチと長さが一定の加工だけを扱う

use crate::{process_with_progress, Algorithm, Formant};

/// 区間の長さと、前後の余白（秒）
pub const SEG_SEC: f64 = 10.0;
pub const MARGIN_SEC: f64 = 0.5;
/// これより短い音は分けない（秒）
pub const MIN_SPLIT_SEC: f64 = 20.0;
/// 境目を探す範囲（境目の予定の前後、秒）と、比べる窓、クロスフェードの長さ（秒）
const SEAM_RANGE_SEC: f64 = 0.2;
const SEAM_WINDOW_SEC: f64 = 0.01;
const FADE_SEC: f64 = 0.02;
/// 境目で次の区間をずらしてよい最大の量（秒）。最も低い声の周期の半分ほど（100Hz で 5ms）
const MAX_LAG_SEC: f64 = 0.005;

/// 1 つの区間。入力のサンプル位置で、`start..end` が受け持つ範囲、`ctx_start..ctx_end` が余白を含めて処理する範囲
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    pub start: usize,
    pub end: usize,
    pub ctx_start: usize,
    pub ctx_end: usize,
}

/// 長さ `len` の音の区間の割り当て。短い音は 1 つ（余白なし）
pub fn plan(len: usize, sample_rate: f32) -> Vec<Segment> {
    let sr = sample_rate as f64;
    if (len as f64) < MIN_SPLIT_SEC * sr {
        return vec![Segment { start: 0, end: len, ctx_start: 0, ctx_end: len }];
    }
    let seg = (SEG_SEC * sr) as usize;
    let margin = (MARGIN_SEC * sr) as usize;
    let count = len.div_ceil(seg);
    // 最後の区間が短くなりすぎないよう、等分する
    let step = len.div_ceil(count);
    (0..count)
        .map(|k| {
            let start = k * step;
            let end = ((k + 1) * step).min(len);
            Segment { start, end, ctx_start: start.saturating_sub(margin), ctx_end: (end + margin).min(len) }
        })
        .collect()
}

/// 区間を加工する（余白を含む範囲）。出力の長さは、余白を含む範囲の長さ × `stretch`
pub fn process_segment(channels: &[&[f32]], seg: &Segment, sample_rate: f32, semitones: f64, stretch: f64, algorithm: Algorithm, formant: Formant) -> Vec<Vec<f32>> {
    let part: Vec<&[f32]> = channels.iter().map(|c| &c[seg.ctx_start..seg.ctx_end]).collect();
    process_with_progress(&part, sample_rate, semitones, stretch, algorithm, formant, &mut |_| {})
}

/// 区間ごとの出力をつなぐ。`outs[k]` は `segs[k]` を `process_segment` で加工したもの。出力の長さは `len × stretch`
pub fn stitch(segs: &[Segment], outs: &[Vec<Vec<f32>>], len: usize, stretch: f64, sample_rate: f32) -> Vec<Vec<f32>> {
    let out_len = (len as f64 * stretch).round() as usize;
    let channels = outs.first().map_or(0, |o| o.len());
    if segs.len() == 1 {
        return outs[0].iter().map(|c| fit(c, out_len)).collect();
    }
    let sr = sample_rate as f64;
    let to_out = |i: usize| (i as f64 * stretch).round() as usize;
    let range = (SEAM_RANGE_SEC * sr * stretch) as usize;
    let win = ((SEAM_WINDOW_SEC * sr * stretch) as usize).max(8);
    let fade = ((FADE_SEC * sr * stretch) as usize).max(8);
    let max_lag = (MAX_LAG_SEC * sr * stretch) as i64;
    // 区間 k の出力の、出力全体での位置 `g` の値（範囲外は 0）。`off[k]` だけずらして読む（境目で波形の位相を合わせるため）
    let at = |off: &[i64], k: usize, c: usize, g: usize| -> f32 {
        let i = g as i64 + off[k] - to_out(segs[k].ctx_start) as i64;
        if i < 0 { 0.0 } else { outs[k][c].get(i as usize).copied().unwrap_or(0.0) }
    };
    let mono = |off: &[i64], k: usize, g: usize| -> f32 { (0..channels).map(|c| at(off, k, c, g)).sum() };
    let mut off = vec![0i64; segs.len()];
    let mut seams = Vec::with_capacity(segs.len() - 1);
    for k in 0..segs.len() - 1 {
        let b = to_out(segs[k].end);
        // 1. 次の区間を ±`max_lag` の範囲でずらし、境目の予定の位置のまわり（前後 `fade`）で前の区間と最も似る量を選ぶ。
        //    区間ごとに処理を始める位置が違うので、同じ時刻でも波形の位相がずれていて、そのままクロスフェードすると打ち消し合う。
        //    ずらす量は区間の中で一定で、出力の位置から最大 `max_lag` しか離れない（たまっていかない）
        let a: Vec<f32> = (b.saturating_sub(fade)..b + fade).map(|g| mono(&off, k, g)).collect();
        let start = b.saturating_sub(fade) as i64 - max_lag;
        let mut o = off.clone();
        o[k + 1] = 0;
        let next: Vec<f32> = (0..a.len() as i64 + 2 * max_lag).map(|i| if start + i < 0 { 0.0 } else { mono(&o, k + 1, (start + i) as usize) }).collect();
        // ずらす量が大きいほど少し不利にする（同じくらい似ているなら、ずらさない方を選ぶ）
        let lag_err = |lag: i64| -> f32 {
            let s = (lag + max_lag) as usize;
            a.iter().zip(&next[s..s + a.len()]).map(|(x, y)| (x - y) * (x - y)).sum::<f32>() * (1.0 + 0.1 * (lag.abs() as f32 / max_lag.max(1) as f32))
        };
        off[k + 1] = (-max_lag..=max_lag).min_by(|&x, &y| lag_err(x).total_cmp(&lag_err(y))).unwrap_or(0);
        // 2. ずらしたうえで、境目の前後 `range` の中で、2 つの出力の波形が最も似ている所を選ぶ（差の 2 乗の累積和で窓の和を求める）
        let lo = b.saturating_sub(range).max(to_out(segs[k + 1].ctx_start) + fade + max_lag as usize);
        let hi = (b + range).min(to_out(segs[k].ctx_end).saturating_sub(win + fade + max_lag as usize));
        if lo >= hi {
            seams.push(b);
            continue;
        }
        let mut acc = vec![0.0f64; hi + win - lo + 1];
        for g in lo..hi + win {
            let d = mono(&off, k, g) - mono(&off, k + 1, g);
            acc[g - lo + 1] = acc[g - lo] + (d * d) as f64;
        }
        seams.push((lo..hi).min_by(|&x, &y| (acc[x - lo + win] - acc[x - lo]).total_cmp(&(acc[y - lo + win] - acc[y - lo]))).map_or(b, |c0| c0 + win / 2));
    }
    let at = |k: usize, c: usize, g: usize| at(&off, k, c, g);
    // 区間ごとに、受け持つ範囲（前の境目から次の境目まで）を写し、境目のまわり `fade` の範囲は隣の区間と混ぜる（Hann の重みで和が 1）
    let half = fade / 2;
    (0..channels)
        .map(|c| {
            let mut y = vec![0.0f32; out_len];
            for k in 0..segs.len() {
                let from = if k == 0 { 0 } else { seams[k - 1] + half };
                let to = if k + 1 == segs.len() { out_len } else { seams[k] - half };
                for (g, v) in y.iter_mut().enumerate().take(to).skip(from) {
                    *v = at(k, c, g);
                }
            }
            for (k, &s) in seams.iter().enumerate() {
                for g in s - half..(s + half).min(out_len) {
                    let w = 0.5 + 0.5 * (std::f64::consts::PI * ((g as f64 - s as f64) / fade as f64 + 0.5)).cos();
                    y[g] = at(k, c, g) * w as f32 + at(k + 1, c, g) * (1.0 - w) as f32;
                }
            }
            y
        })
        .collect()
}

fn fit(c: &[f32], n: usize) -> Vec<f32> {
    let mut v = c.to_vec();
    v.resize(n, 0.0);
    v
}

/// ネイティブで、スレッド `threads` 本で区間を並列に加工する（テストと計測用。wasm は TypeScript が Worker に配る）
#[cfg(not(target_arch = "wasm32"))]
pub fn process_parallel(channels: &[&[f32]], sample_rate: f32, semitones: f64, stretch: f64, algorithm: Algorithm, formant: Formant, threads: usize) -> Vec<Vec<f32>> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    let len = channels.first().map_or(0, |c| c.len());
    let segs = plan(len, sample_rate);
    let next = AtomicUsize::new(0);
    let outs: Mutex<Vec<Option<Vec<Vec<f32>>>>> = Mutex::new(vec![None; segs.len()]);
    std::thread::scope(|s| {
        for _ in 0..threads.max(1) {
            s.spawn(|| loop {
                // 終わったスレッドが次の区間を取る
                let k = next.fetch_add(1, Ordering::Relaxed);
                let Some(seg) = segs.get(k) else { break };
                let y = process_segment(channels, seg, sample_rate, semitones, stretch, algorithm, formant);
                outs.lock().unwrap()[k] = Some(y);
            });
        }
    });
    let outs: Vec<Vec<Vec<f32>>> = outs.into_inner().unwrap().into_iter().map(|o| o.unwrap()).collect();
    stitch(&segs, &outs, len, stretch, sample_rate)
}

//! 正弦波と雑音のモデル（SMS、Spectral Modeling Synthesis）による時間伸縮。愛称は Specraw。できるだけ可逆な方式。
//! 目的は、曲そのもの（和音や伴奏を含む）のピッチを変えても劣化しにくいこと。
//!
//! 音を、ゆっくり変わる正弦波の集まり（周波数と振幅の軌跡）と、残りの雑音（帯域ごとの強さ）に分け、
//! 出力の時刻に対応する入力の時刻の値で鳴らし直す。倍音に限らない正弦波の集まりなので、和音や楽器にも使える。
//! 鳴らし直した音をもう一度分けると、ほぼ同じ値が得られるので、伸縮を往復させたり重ねたりしても誤差がたまりにくい
//! （最初に分けたときの誤差が残るだけ）。位相は鳴らし直すときに作るので、波形は元と同じにはならないが、
//! 聞こえ方（振幅スペクトル）は保たれる。音質より、往復や重ねた加工で劣化しにくいことを優先する（docs/ALGORITHM.md の SMS）。

use crate::{fft::Fft, TimeMap};
use std::collections::HashMap;
use std::f64::consts::PI;
use crate::window::hann;

/// 分析の窓（48kHz で 2048 サンプル。低い音の倍音を分けられ、ビブラートで山がぼやけない長さ。4096 では振幅を小さく見積もった）と、分析の間隔
const FRAME_SEC: f64 = 0.03;
const HOP_SEC: f64 = 0.005;
/// 鳴らし直す間隔（出力のサンプル）。この間は周波数と振幅を直線でつなぐ
const SYNTH_HOP: usize = 128;
/// 正弦波とみなす山の下限（そのフレームの最大から何 dB 下まで）
const FLOOR_DB: f32 = 70.0;
/// 1 フレームに使う山の数の上限
const MAX_PEAKS: usize = 300;
/// 前のフレームの山とつなぐ周波数の差の上限（Hz と、周波数に対する割合の大きい方）
const LINK_HZ: f64 = 20.0;
const LINK_RATIO: f64 = 0.03;
/// 正弦波とみなす軌跡の短さの下限（フレーム数）。これより短い山は雑音として扱う（雑音の中の山が、ちらつく正弦波にならないように）
const MIN_TRACK: usize = 6;
/// 雑音の帯域の数（対数の間隔）と、雑音を鳴らし直す窓（48kHz で 512 サンプル。子音がにじみすぎない長さ）
const NOISE_BANDS: usize = 48;
const NOISE_FRAME_SEC: f64 = 0.01;

/// 1 つの山（正弦波）。`track` は時間方向につないだ番号
#[derive(Clone, Copy)]
struct Peak {
    hz: f64,
    amp: f64,
    track: u32,
}

/// 分けた結果。フレームごとの正弦波と、雑音の帯域ごとの強さ（1 サンプルあたりの分散）
struct Model {
    sines: Vec<Vec<Peak>>,
    noise: Vec<[f32; NOISE_BANDS]>,
    /// 帯域の境目（分析の窓での bin。帯域 j は edges[j]..edges[j+1]）
    edges: Vec<usize>,
    /// 分析の窓の長さ
    n: usize,
}

/// 全チャンネルを `alpha` 倍に時間伸縮する（出力長 = 入力長 × alpha）。
pub fn stretch(channels: &[&[f32]], alpha: f64, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    if (alpha - 1.0).abs() < 1e-9 {
        return channels.iter().map(|c| c.to_vec()).collect();
    }
    let out_len = (len as f64 * alpha).round() as usize;
    stretch_map(channels, &TimeMap::linear(len, out_len), sample_rate, progress)
}

/// 任意の時間対応 `map` で全チャンネルを伸縮する。チャンネルごとに分けて鳴らし直す。
pub fn stretch_map(channels: &[&[f32]], map: &TimeMap, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let n = channels.len().max(1) as f64;
    let sr = sample_rate as f64;
    channels
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let model = analyze(c, sr);
            progress((i as f64 + 0.5) / n);
            let mut y = synthesize_sines(&model.sines, c.len(), map, sr);
            add_noise(&mut y, &model, c.len(), map, sr);
            y
        })
        .collect()
}

/// 分析の窓の長さと間隔、窓
fn frame_setup(sr: f64) -> (usize, usize, Vec<f32>) {
    let n = ((sr * FRAME_SEC) as usize).next_power_of_two();
    let hop = ((sr * HOP_SEC) as usize).max(1);
    let window = hann(n);
    (n, hop, window)
}

/// フレーム `k` の振幅スペクトル（`mag` に入れる）。中心が k * hop に来るように切り出す。
/// 両端は窓が信号からはみ出して小さく出るので、中心を内側に寄せる
fn spectrum(x: &[f32], k: usize, hop: usize, window: &[f32], fft: &Fft, re: &mut [f32], im: &mut [f32], mag: &mut [f32]) {
    let n = window.len();
    let center = if x.len() > n { (k * hop).clamp(n / 2, x.len() - n / 2) } else { k * hop };
    let start = center as i64 - (n / 2) as i64;
    for i in 0..n {
        let s = start + i as i64;
        re[i] = if s >= 0 && (s as usize) < x.len() { x[s as usize] * window[i] } else { 0.0 };
        im[i] = 0.0;
    }
    fft.run(re, im, false);
    for (b, m) in mag.iter_mut().enumerate() {
        *m = (re[b] * re[b] + im[b] * im[b]).sqrt();
    }
}

/// 分析: フレームごとに山を拾って前のフレームの山とつなぎ、短い軌跡を除く。残りを雑音の強さにする
fn analyze(x: &[f32], sr: f64) -> Model {
    let (n, hop, window) = frame_setup(sr);
    let fft = Fft::new(n);
    let w2: f32 = window.iter().map(|w| w * w).sum();
    let floor = 10f32.powf(-FLOOR_DB / 20.0);
    let (mut re, mut im) = (vec![0.0f32; n], vec![0.0f32; n]);
    let mut mag = vec![0.0f32; n / 2 + 1];
    let mut sines: Vec<Vec<Peak>> = Vec::new();
    let mut next_track = 0u32;
    let count = x.len() / hop + 1;
    for k in 0..count {
        spectrum(x, k, hop, &window, &fft, &mut re, &mut im, &mut mag);
        let top = mag.iter().cloned().fold(0.0f32, f32::max);
        let mut peaks: Vec<Peak> = Vec::new();
        if top > 1e-7 {
            for b in 1..mag.len() - 1 {
                let c = mag[b];
                if c > mag[b - 1] && c >= mag[b + 1] && c > top * floor {
                    // 対数振幅の放物線で、山の本当の位置と高さを求める
                    let (l, m, r) = (mag[b - 1].max(1e-12).ln(), c.ln(), mag[b + 1].max(1e-12).ln());
                    let d = l - 2.0 * m + r;
                    let p = if d.abs() > 1e-12 { (0.5 * (l - r) / d).clamp(-0.5, 0.5) } else { 0.0 };
                    // 振幅は山の高さではなく、山のまわり（±2 bin）のエネルギーから求める。周波数が窓の中で動く（ビブラートなど）と山が広がり、
                    // 高さで求めると小さく見積もる。鳴らし直すたびに小さくなって、往復で誤差がたまる
                    let energy: f32 = mag[b.saturating_sub(2)..(b + 3).min(mag.len())].iter().map(|v| v * v).sum();
                    let amp = 2.0 * (energy as f64 / (n as f64 * w2 as f64)).sqrt();
                    peaks.push(Peak { hz: (b as f64 + p as f64) * sr / n as f64, amp, track: 0 });
                }
            }
            if peaks.len() > MAX_PEAKS {
                peaks.sort_by(|a, b| b.amp.total_cmp(&a.amp));
                peaks.truncate(MAX_PEAKS);
                peaks.sort_by(|a, b| a.hz.total_cmp(&b.hz));
            }
        }
        // 前のフレームの山のうち、周波数が近く、まだつないでいないものとつなぐ（大きい山から順に）
        let prev = sines.last().map(|f| f.as_slice()).unwrap_or(&[]);
        let mut used = vec![false; prev.len()];
        let mut order: Vec<usize> = (0..peaks.len()).collect();
        order.sort_by(|&a, &b| peaks[b].amp.total_cmp(&peaks[a].amp));
        for i in order {
            let hz = peaks[i].hz;
            let limit = LINK_HZ.max(hz * LINK_RATIO);
            let best = prev
                .iter()
                .enumerate()
                .filter(|(j, p)| !used[*j] && (p.hz - hz).abs() < limit)
                .min_by(|a, b| (a.1.hz - hz).abs().total_cmp(&(b.1.hz - hz).abs()));
            peaks[i].track = match best {
                Some((j, p)) => {
                    used[j] = true;
                    p.track
                }
                None => {
                    next_track += 1;
                    next_track
                }
            };
        }
        sines.push(peaks);
    }

    // 短い軌跡は正弦波から外す
    let mut lengths: HashMap<u32, usize> = HashMap::new();
    for f in &sines {
        for p in f {
            *lengths.entry(p.track).or_default() += 1;
        }
    }
    for f in sines.iter_mut() {
        f.retain(|p| lengths[&p.track] >= MIN_TRACK);
    }

    // 雑音: 正弦波の山のまわり（窓の主な山の幅）を除いた bin の強さを、帯域ごとに平均する。
    // 1 サンプルあたりの分散にそろえる（|X|^2 = 分散 × 窓の 2 乗和）
    let edges = band_edges(n);
    let mut masked = vec![false; n / 2 + 1];
    let noise = (0..count)
        .map(|k| {
            spectrum(x, k, hop, &window, &fft, &mut re, &mut im, &mut mag);
            masked.fill(false);
            for p in &sines[k] {
                let b = (p.hz * n as f64 / sr).round() as i64;
                for d in -3..=3 {
                    if let Some(m) = masked.get_mut((b + d).max(0) as usize) {
                        *m = true;
                    }
                }
            }
            let mut bands = [0.0f32; NOISE_BANDS];
            for (j, v) in bands.iter_mut().enumerate() {
                let (mut sum, mut cnt) = (0.0f32, 0usize);
                for b in edges[j]..edges[j + 1] {
                    if !masked[b] {
                        sum += mag[b] * mag[b];
                        cnt += 1;
                    }
                }
                *v = if cnt > 0 { sum / cnt as f32 / w2 } else { 0.0 };
            }
            bands
        })
        .collect();
    Model { sines, noise, edges, n }
}

/// 雑音の帯域の境目（bin）。1 bin から n/2 までを対数の間隔に分ける
fn band_edges(n: usize) -> Vec<usize> {
    let top = (n / 2) as f64;
    let mut edges: Vec<usize> = (0..=NOISE_BANDS).map(|j| top.powf(j as f64 / NOISE_BANDS as f64).round() as usize).collect();
    for j in 1..edges.len() {
        edges[j] = edges[j].max(edges[j - 1] + 1);
    }
    edges[NOISE_BANDS] = n / 2 + 1;
    edges
}

/// 入力のフレーム位置 `f`（小数）での山。隣のフレームに同じ軌跡があれば、周波数と振幅を直線で補間する
fn peaks_at(frames: &[Vec<Peak>], f: f64) -> Vec<Peak> {
    let a = (f.floor().max(0.0) as usize).min(frames.len() - 1);
    let b = (a + 1).min(frames.len() - 1);
    let g = (f - a as f64).clamp(0.0, 1.0);
    frames[a]
        .iter()
        .map(|p| match frames[b].iter().find(|q| q.track == p.track) {
            Some(q) => Peak { hz: p.hz + (q.hz - p.hz) * g, amp: p.amp + (q.amp - p.amp) * g, track: p.track },
            // 次のフレームで途切れる軌跡は、だんだん小さくする
            None => Peak { amp: p.amp * (1.0 - g), ..*p },
        })
        .collect()
}

/// 正弦波を鳴らし直す: 出力の `SYNTH_HOP` ごとに、対応する入力の時刻の山を求め、その間を直線でつないで足す。
/// 位相は軌跡ごとに周波数を積み上げる（途切れずにつながる）
fn synthesize_sines(frames: &[Vec<Peak>], len: usize, map: &TimeMap, sr: f64) -> Vec<f32> {
    let out_len = map.out_len;
    let mut out = vec![0.0f32; out_len];
    if frames.is_empty() || len == 0 {
        return out;
    }
    let hop = ((sr * HOP_SEC) as usize).max(1) as f64;
    let at = |o: usize| peaks_at(frames, map.input_at(o as f64).clamp(0.0, (len - 1) as f64) / hop);
    let mut phases: HashMap<u32, f64> = HashMap::new();
    let mut cur = at(0);
    let mut o = 0usize;
    while o < out_len {
        let end = (o + SYNTH_HOP).min(out_len);
        let next = at(end);
        let steps = (end - o) as f64;
        let mut seen: HashMap<u32, f64> = HashMap::new();
        for p in &cur {
            // 次の時刻での同じ軌跡（なければ同じ周波数で小さくしていく）
            let q = next.iter().find(|q| q.track == p.track).copied().unwrap_or(Peak { amp: 0.0, ..*p });
            let mut ph = phases.get(&p.track).copied().unwrap_or(0.0);
            for (i, s) in out[o..end].iter_mut().enumerate() {
                let g = i as f64 / steps;
                let hz = p.hz + (q.hz - p.hz) * g;
                let amp = p.amp + (q.amp - p.amp) * g;
                ph += 2.0 * PI * hz / sr;
                *s += (amp * ph.sin()) as f32;
            }
            seen.insert(p.track, ph % (2.0 * PI));
        }
        // 次の区間で新しく始まる軌跡は、0 から大きくする
        for q in &next {
            if !cur.iter().any(|p| p.track == q.track) {
                let mut ph = 0.0f64;
                for (i, s) in out[o..end].iter_mut().enumerate() {
                    let amp = q.amp * i as f64 / steps;
                    ph += 2.0 * PI * q.hz / sr;
                    *s += (amp * ph.sin()) as f32;
                }
                seen.insert(q.track, ph % (2.0 * PI));
            }
        }
        phases = seen;
        cur = next;
        o = end;
    }
    out
}

/// 雑音を鳴らし直して `out` に足す。出力の短い窓ごとに、対応する入力の時刻の帯域の強さで、位相のでたらめなスペクトルを作り、
/// 逆変換して重ね合わせる。分散がそろうよう、振幅は sqrt(分散 × 窓の長さ × 重なりの窓の 2 乗和) にする
fn add_noise(out: &mut [f32], model: &Model, len: usize, map: &TimeMap, sr: f64) {
    let frames = &model.noise;
    if frames.is_empty() || len == 0 {
        return;
    }
    let hop = ((sr * HOP_SEC) as usize).max(1) as f64;
    let ns = ((sr * NOISE_FRAME_SEC) as usize).next_power_of_two();
    let hs = ns / 4;
    let fft = Fft::new(ns);
    let window: Vec<f32> = hann(ns);
    // 重なる窓の 2 乗和（Hann を 4 分の 1 ずつずらすと 1.5）
    let overlap = window.iter().map(|w| w * w).sum::<f32>() / hs as f32;
    // 分析の窓の bin から、鳴らし直す窓の bin への対応
    let band_of: Vec<usize> = (0..=ns / 2)
        .map(|b| {
            let ab = b * model.n / ns;
            model.edges.windows(2).position(|e| ab >= e[0] && ab < e[1]).unwrap_or(NOISE_BANDS - 1)
        })
        .collect();
    let mut seed: u32 = 0x2468_ace1;
    let mut rand = move || {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (seed >> 8) as f64 / (1u32 << 24) as f64
    };
    let out_len = out.len();
    let mut acc = vec![0.0f32; out_len + ns];
    let mut norm = vec![0.0f32; out_len + ns];
    let (mut re, mut im) = (vec![0.0f32; ns], vec![0.0f32; ns]);
    let mut o = 0usize;
    while o < out_len + ns / 2 {
        // 窓の中心の出力位置 → 入力のフレーム位置。隣のフレームと直線で補間する
        let center = (o as f64 - (ns / 2) as f64).clamp(0.0, (out_len.max(1) - 1) as f64);
        let f = map.input_at(center).clamp(0.0, (len - 1) as f64) / hop;
        let a = (f.floor() as usize).min(frames.len() - 1);
        let b = (a + 1).min(frames.len() - 1);
        let g = (f - a as f64) as f32;
        re.fill(0.0);
        im.fill(0.0);
        for k in 1..ns / 2 {
            let j = band_of[k];
            let var = frames[a][j] + (frames[b][j] - frames[a][j]) * g;
            let m = (var * ns as f32 * overlap).sqrt();
            let ph = 2.0 * PI * rand();
            let (c, s) = ((m as f64 * ph.cos()) as f32, (m as f64 * ph.sin()) as f32);
            re[k] = c;
            im[k] = s;
            re[ns - k] = c;
            im[ns - k] = -s;
        }
        fft.run(&mut re, &mut im, true);
        // `o` は窓の頭の位置（出力の先頭より ns/2 前から始める）
        for i in 0..ns {
            let p = o + i;
            if p < ns / 2 {
                continue;
            }
            let q = p - ns / 2;
            if q >= out_len + ns {
                break;
            }
            acc[q] += window[i] * re[i] / ns as f32;
            norm[q] += window[i] * window[i];
        }
        o += hs;
    }
    for (i, s) in out.iter_mut().enumerate() {
        if norm[i] > 1e-3 {
            *s += acc[i] / norm[i];
        }
    }
}

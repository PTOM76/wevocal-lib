//! 打楽器分離（HPSS）を使った時間伸縮（Driedger, Müller, Ewert 2014）。
//!
//! 音を「伸びる成分（和音など。スペクトログラムで横に伸びる）」と「打つ成分（打楽器など。縦に伸びる）」に分け、
//! 伸びる成分は Phase Vocoder、打つ成分は短い窓のオーバーラップ加算（OLA）で伸ばして足し戻す。
//! Phase Vocoder は立ち上がりがにじみ、短い窓の OLA は伸びる音がうなるので、得意なほうに任せる。
//!
//! 分離は、振幅スペクトログラムを時間方向にメディアンフィルタしたもの（伸びる成分が残る）と、
//! 周波数方向にメディアンフィルタしたもの（打つ成分が残る）を比べ、大きいほうに各成分を振り分ける（2 値のマスク）。
//! 全体の STFT を持つとメモリが大きいので、時間方向のメディアンに要る前後のフレームだけを持ちながら順に処理する。

use crate::fft::Fft;
use crate::{pv, TimeMap};
use crate::window::hann;

/// 分離の STFT のフレーム長（秒。2 のべき乗に切り上げる）
const SEP_FRAME_SEC: f32 = 0.046;
/// メディアンフィルタの長さ（時間方向はフレーム数、周波数方向はビン数。どちらも奇数）
const MEDIAN_TIME: usize = 17;
const MEDIAN_FREQ: usize = 17;
/// 打つ成分を伸ばす OLA の窓の長さ（秒）。短いほど立ち上がりが崩れない
const OLA_FRAME_SEC: f32 = 0.01;

/// 全チャンネルを `alpha` 倍に時間伸縮する（出力長 = 入力長 × alpha）
pub fn stretch(channels: &[&[f32]], alpha: f64, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    if (alpha - 1.0).abs() < 1e-9 {
        return channels.iter().map(|c| c.to_vec()).collect();
    }
    let out_len = (len as f64 * alpha).round() as usize;
    stretch_map(channels, &TimeMap::linear(len, out_len), sample_rate, progress)
}

/// 任意の時間対応 `map` で全チャンネルを伸縮する
pub fn stretch_map(channels: &[&[f32]], map: &TimeMap, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    if len == 0 || map.out_len == 0 {
        return vec![Vec::new(); channels.len()];
    }
    let (harmonic, percussive) = separate(channels, sample_rate, &mut |p| progress(p * 0.3));
    let h: Vec<&[f32]> = harmonic.iter().map(|c| c.as_slice()).collect();
    let p: Vec<&[f32]> = percussive.iter().map(|c| c.as_slice()).collect();
    let mut out = pv::stretch_map(&h, map, sample_rate, &mut |q| progress(0.3 + q * 0.6));
    let perc = ola(&p, map, sample_rate);
    for (o, q) in out.iter_mut().zip(&perc) {
        for (a, b) in o.iter_mut().zip(q) {
            *a += b;
        }
    }
    progress(1.0);
    out
}

use crate::math::median;

/// 伸びる成分と打つ成分に分ける（どちらも入力と同じ長さ・チャンネル数）。マスクはモノラルにまとめた音で決め、全チャンネルに使う
pub fn separate(channels: &[&[f32]], sample_rate: f32, progress: &mut dyn FnMut(f64)) -> (Vec<Vec<f32>>, Vec<Vec<f32>>) {
    let len = channels[0].len();
    let n = ((sample_rate * SEP_FRAME_SEC) as usize).max(256).next_power_of_two();
    let hop = n / 4;
    let bins = n / 2 + 1;
    let fft = Fft::new(n);
    let window: Vec<f32> = hann(n);
    // 先頭と末尾も窓の中ほどで扱えるよう、半フレーム分ずらして始める
    let start = -(n as i64 / 2);
    let frames = ((len as i64 - start) as usize).div_ceil(hop) + 1;
    let frame_pos = |k: usize| start + (k * hop) as i64;
    let sample = |c: &[f32], i: i64| if i >= 0 && (i as usize) < len { c[i as usize] } else { 0.0 };

    let (mut re, mut im) = (vec![0.0f32; n], vec![0.0f32; n]);
    // モノラルの振幅スペクトルを、時間方向のメディアンに要る前後のフレーム分だけ持つ（リングバッファ）
    let half = MEDIAN_TIME / 2;
    let mut ring = vec![vec![0.0f32; bins]; MEDIAN_TIME];
    let mono_mag = |k: usize, out: &mut [f32], re: &mut [f32], im: &mut [f32]| {
        let p = frame_pos(k);
        for i in 0..n {
            re[i] = channels.iter().map(|c| sample(c, p + i as i64)).sum::<f32>() / channels.len() as f32 * window[i];
            im[i] = 0.0;
        }
        fft.run(re, im, false);
        for b in 0..bins {
            out[b] = (re[b] * re[b] + im[b] * im[b]).sqrt();
        }
    };
    // 最初のフレームの前は 0（フレームの外）とみなす
    for k in 0..half.min(frames) {
        let slot = (k + half) % MEDIAN_TIME;
        mono_mag(k, &mut ring[slot], &mut re, &mut im);
    }

    let mut harmonic = vec![vec![0.0f32; len]; channels.len()];
    let mut percussive = vec![vec![0.0f32; len]; channels.len()];
    let mut norm = vec![0.0f32; len];
    let mut mask = vec![false; bins];
    let mut buf = Vec::with_capacity(MEDIAN_TIME.max(MEDIAN_FREQ));
    let (mut hr, mut hi_) = (vec![0.0f32; n], vec![0.0f32; n]);
    let scale = 1.0 / n as f32;

    for k in 0..frames {
        if k % 256 == 0 {
            progress(k as f64 / frames as f64);
        }
        // 先のフレームを読み込む（k + half）。範囲外は 0
        let ahead = k + half;
        let slot = (ahead + half) % MEDIAN_TIME;
        if ahead < frames {
            mono_mag(ahead, &mut ring[slot], &mut re, &mut im);
        } else {
            ring[slot].fill(0.0);
        }
        // 今のフレーム k は、リングの (k + half) % MEDIAN_TIME にある
        let cur = &ring[(k + half) % MEDIAN_TIME];
        for b in 0..bins {
            let h = median(ring.iter().map(|f| f[b]), &mut buf);
            let lo = b.saturating_sub(MEDIAN_FREQ / 2);
            let hi = (b + MEDIAN_FREQ / 2).min(bins - 1);
            let p = median(cur[lo..=hi].iter().copied(), &mut buf);
            mask[b] = h >= p;
        }
        // 各チャンネルのこのフレームを変換し、マスクで分けて戻す（窓をかけて足し、最後に窓の 2 乗の和で割る）
        let p0 = frame_pos(k);
        for (ci, c) in channels.iter().enumerate() {
            for i in 0..n {
                re[i] = sample(c, p0 + i as i64) * window[i];
                im[i] = 0.0;
            }
            fft.run(&mut re, &mut im, false);
            // 伸びる成分を実部、打つ成分を虚部に詰めて 1 回で逆変換する（どちらも実信号なので混ざらない）
            for b in 0..n {
                let bb = if b < bins { b } else { n - b };
                let (xr, xi) = (re[b], im[b]);
                if mask[bb] {
                    hr[b] = xr;
                    hi_[b] = xi;
                } else {
                    // i·X を足すと、逆変換の虚部に X の信号が出る
                    hr[b] = -xi;
                    hi_[b] = xr;
                }
            }
            fft.run(&mut hr, &mut hi_, true);
            for i in 0..n {
                let t = p0 + i as i64;
                if t < 0 || t as usize >= len {
                    continue;
                }
                let w = window[i] * scale;
                harmonic[ci][t as usize] += hr[i] * w;
                percussive[ci][t as usize] += hi_[i] * w;
            }
        }
        for i in 0..n {
            let t = p0 + i as i64;
            if t >= 0 && (t as usize) < len {
                norm[t as usize] += window[i] * window[i];
            }
        }
    }
    for (h, p) in harmonic.iter_mut().zip(percussive.iter_mut()) {
        for ((a, b), &w) in h.iter_mut().zip(p.iter_mut()).zip(&norm) {
            let w = if w > 1e-3 { w } else { 1.0 };
            *a /= w;
            *b /= w;
        }
    }
    progress(1.0);
    (harmonic, percussive)
}

/// 短い窓のオーバーラップ加算（位置合わせの探索なし）。立ち上がりの形を崩さずに伸ばす
fn ola(channels: &[&[f32]], map: &TimeMap, sample_rate: f32) -> Vec<Vec<f32>> {
    let len = channels[0].len();
    let out_len = map.out_len;
    let mut n = ((sample_rate * OLA_FRAME_SEC) as usize).max(32);
    n += n % 2;
    let hs = n / 2;
    let window: Vec<f32> = hann(n);
    let last_pos = len.saturating_sub(n) as f64;
    let mut out = vec![vec![0.0f32; out_len + n]; channels.len()];
    let mut wsum = vec![0.0f32; out_len + n];
    for k in 0..out_len / hs + 1 {
        let pos = map.frame_pos(k * hs, len, n).round().clamp(0.0, last_pos) as usize;
        for i in 0..n {
            wsum[k * hs + i] += window[i];
            if pos + i < len {
                for (o, c) in out.iter_mut().zip(channels) {
                    o[k * hs + i] += window[i] * c[pos + i];
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

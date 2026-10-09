//! identity phase locking（Laroche & Dolson）付き Phase Vocoder による時間伸縮。
//!
//! 大きな伸長でも WSOLA よりなめらか（断片の繰り返しがない）。その代わり
//! 多少の残響感（フェージー感）が出て、アタックがにじむ。
//!
//! Phase Vocoder v2（`stretch2` / `stretch_map2`）は立ち上がりを保つ。立ち上がりを含む分析フレームが
//! 出力の別々の場所に置かれるのがにじみの原因なので、立ち上がりのまわりだけ伸ばさずに等倍で進め、
//! 区間に入るところで位相を入力に戻す。伸ばさなかった分は、まわりの部分で取り戻す
//!
//! 速くするための工夫（結果は素直な実装と同じ）:
//! - identity phase locking は「各ビンに、最寄りのピークの位相の回し量を複素数で掛ける」形で行う。
//!   三角関数（atan2・sin/cos）はピークのビンだけで済み、全ビンで求めなくてよい
//! - ピークの回し量は、位相差を x · conj(前の x) の偏角（atan2 1 回）で、回し量を単位複素数の積と sin/cos 1 回で作る
//!   （入力・前の入力・前の出力の位相をそれぞれ atan2 で求めると 3 回かかった）
//! - 同じチャンネルの隣り合う2フレームを、実部と虚部に詰めて1回の複素 FFT でまとめて変換する

use crate::fft::Fft;
use crate::TimeMap;
use std::f64::consts::PI;
use crate::window::hann;

/// 分析・合成フレーム長（秒）。2のべき乗に切り上げる。
const FRAME_SEC: f32 = 0.046;
/// 合成ホップ = フレーム長 / この値（75% オーバーラップ）。
const OVERLAP: usize = 4;
/// 立ち上がり保持（Phase Vocoder v2）: スペクトルの増え方（フラックス）が平均 + この倍の標準偏差を超えた所を立ち上がりとみなす
const ONSET_SIGMA: f32 = 1.5;

use crate::math::wrap_phase as wrap;

/// 全チャンネルを `alpha` 倍に時間伸縮する（出力長 = 入力長 × alpha）。
pub fn stretch(
    channels: &[&[f32]],
    alpha: f64,
    sample_rate: f32,
    progress: &mut dyn FnMut(f64),
) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    if (alpha - 1.0).abs() < 1e-9 {
        return channels.iter().map(|c| c.to_vec()).collect();
    }
    let out_len = (len as f64 * alpha).round() as usize;
    stretch_map(
        channels,
        &TimeMap::linear(len, out_len),
        sample_rate,
        progress,
    )
}

/// 1チャンネルぶんの、フレームをまたいで持ち越す状態
struct ChannelState {
    /// 前のフレームの入力スペクトルと出力スペクトル（ビンごとの複素数）
    prev_x: Vec<(f32, f32)>,
    prev_y: Vec<(f32, f32)>,
    /// ビンごとの直近の瞬時周波数（rad/sample）。入力の末尾で分析位置が動かなくなったフレームで使い回す。
    inst: Vec<f64>,
}

impl ChannelState {
    fn new(bins: usize, n: usize) -> Self {
        ChannelState {
            prev_x: vec![(0.0, 0.0); bins],
            prev_y: vec![(0.0, 0.0); bins],
            inst: (0..bins).map(|b| 2.0 * PI * b as f64 / n as f64).collect(),
        }
    }
}

/// 1チャンネルの入力スペクトル `x` から出力スペクトル `y` を作る（位相を合成ホップ分進める）
#[allow(clippy::too_many_arguments)]
fn advance(
    st: &mut ChannelState,
    x: &[(f32, f32)],
    y: &mut [(f32, f32)],
    first: bool,
    hop: usize,
    hs: usize,
    n: usize,
    peaks: &mut Vec<usize>,
    rot: &mut Vec<(f32, f32)>,
) {
    let bins = x.len();
    if first {
        y.copy_from_slice(x);
    } else {
        let mag2 = |b: usize| x[b].0 * x[b].0 + x[b].1 * x[b].1;

        peaks.clear();
        for b in 1..bins - 1 {
            let m = mag2(b);
            if m > mag2(b - 1) && m >= mag2(b + 1) {
                peaks.push(b);
            }
        }
        if peaks.is_empty() {
            peaks.push(0);
        }
        // ピークごとに、入力の位相から出力の位相への回し量 e^{i(出力位相 - 入力位相)} を求める
        rot.clear();
        // 単位複素数（大きさ 0 なら 1）
        let unit = |(r, i): (f32, f32)| {
            let m = (r * r + i * i).sqrt();
            if m > 1e-20 { (r / m, i / m) } else { (1.0, 0.0) }
        };
        for &p in peaks.iter() {
            // 位相差は x · conj(前の x) の偏角として 1 回の atan2 で求める（入力・前の入力の位相を別々に求めない）
            if hop > 0 {
                let ha = hop as f64;
                let omega = 2.0 * PI * p as f64 / n as f64;
                let (xr, xi) = x[p];
                let (pr, pi) = st.prev_x[p];
                let dphi = (xi * pr - xr * pi).atan2(xr * pr + xi * pi) as f64;
                st.inst[p] = omega + wrap(dphi - omega * ha) / ha;
            }
            // 回し量 = 出力の前の位相 + 進める量 - 入力の位相。偏角を求めず、単位複素数の積で作る
            let (s, c) = (wrap(st.inst[p] * hs as f64) as f32).sin_cos();
            let (yr, yi) = unit(st.prev_y[p]);
            let (xr, xi) = unit(x[p]);
            // e^{i·出力の前の位相} · e^{-i·入力の位相}
            let (ar, ai) = (yr * xr + yi * xi, yi * xr - yr * xi);
            rot.push((ar * c - ai * s, ar * s + ai * c));
        }
        // identity phase locking: 各ビンは最寄りのピーク（境界はピーク間の中点）と同じだけ位相を回す
        let mut pi = 0;
        for b in 0..bins {
            while pi + 1 < peaks.len() && b > (peaks[pi] + peaks[pi + 1]) / 2 {
                pi += 1;
            }
            let (c, s) = rot[pi];
            let (xr, xi) = x[b];
            y[b] = (xr * c - xi * s, xr * s + xi * c);
        }
    }
    st.prev_x.copy_from_slice(x);
    st.prev_y.copy_from_slice(y);
}

/// 立ち上がりの位置（入力のサンプル）を見つける。モノラルにまとめた音のスペクトルの増え方（フラックス）が、
/// 平均 + `ONSET_SIGMA` × 標準偏差を超えて、前後より大きいフレーム
fn detect_onsets(channels: &[&[f32]], fft: &Fft, window: &[f32], n: usize, hop: usize) -> Vec<usize> {
    let len = channels[0].len();
    let bins = n / 2 + 1;
    let (mut re, mut im) = (vec![0.0f32; n], vec![0.0f32; n]);
    let mut prev = vec![0.0f32; bins];
    let mut flux = Vec::new();
    let mut pos = 0;
    while pos + n <= len {
        for i in 0..n {
            re[i] = channels.iter().map(|c| c[pos + i]).sum::<f32>() / channels.len() as f32 * window[i];
            im[i] = 0.0;
        }
        fft.run(&mut re, &mut im, false);
        let mut f = 0.0f32;
        for b in 0..bins {
            let m = (re[b] * re[b] + im[b] * im[b]).sqrt();
            f += (m - prev[b]).max(0.0);
            prev[b] = m;
        }
        flux.push(f);
        pos += hop;
    }
    if flux.len() < 3 {
        return Vec::new();
    }
    let mean = flux.iter().sum::<f32>() / flux.len() as f32;
    let sd = (flux.iter().map(|f| (f - mean) * (f - mean)).sum::<f32>() / flux.len() as f32).sqrt();
    let th = mean + ONSET_SIGMA * sd;
    // フラックスが最大になるフレームは、立ち上がりが窓のどこにあるかで前後に 2 フレームほどぶれるので、
    // 窓の範囲の中で、短い区間（32 サンプル）ごとの音量が最も増えた所を立ち上がりの位置にする
    const BLOCK: usize = 32;
    let energy = |a: usize| (a..(a + BLOCK).min(len)).map(|i| channels.iter().map(|c| c[i] * c[i]).sum::<f32>()).sum::<f32>();
    (1..flux.len() - 1)
        .filter(|&k| flux[k] > th && flux[k] >= flux[k - 1] && flux[k] > flux[k + 1])
        .map(|k| {
            let (from, to) = ((k * hop).saturating_sub(n / 2), (k * hop + n).min(len.saturating_sub(BLOCK)));
            let mut best = (k * hop + n / 2, f32::MIN);
            let mut prev = energy(from.saturating_sub(BLOCK));
            let mut a = from;
            while a < to {
                let e = energy(a);
                if e - prev > best.1 {
                    best = (a, e - prev);
                }
                prev = e;
                a += BLOCK;
            }
            best.0
        })
        .collect()
}

/// 立ち上がりのまわりでは入力も合成ホップと同じ幅で進める（伸ばさない）。
/// 各立ち上がりは元の対応どおりの出力時刻に置き（窓の中ほどに立ち上がりが来るフレームを、元の対応で決まるフレームに固定する）、
/// その前後 `ZONE_BEFORE` / `ZONE_AFTER` フレームを等倍で進める。区間と区間の間は、端どうしを直線でつなぐ。
/// 立ち上がりの時刻を固定するので、ずれは溜まらない（ずれを後から少しずつ取り戻す形にすると、続けて鳴るドラムがだんだんずれた）。
/// 区間の最初のフレームで位相を入力に戻す（`reset`）
fn keep_transients(positions: &mut [usize], reset: &mut [bool], onsets: &[usize], map: &TimeMap, n: usize, hs: usize, last_pos: usize) {
    /// 立ち上がりのフレームの前後で等倍にするフレーム数（窓が立ち上がりを含むのは、前後 n / hs / 2 フレームほど）
    const ZONE_BEFORE: usize = 2;
    const ZONE_AFTER: usize = 2;
    let frames = positions.len();
    if onsets.is_empty() || frames < 2 {
        return;
    }
    let orig: Vec<f64> = positions.iter().map(|&p| p as f64).collect();
    // 入力位置 `x` が来る出力位置（元の対応 `map` を逆にたどる。単調増加なので二分探索）
    let output_of = |x: f64| {
        let (mut lo, mut hi) = (0.0f64, map.out_len as f64);
        for _ in 0..48 {
            let mid = (lo + hi) / 2.0;
            if map.input_at(mid) < x { lo = mid } else { hi = mid }
        }
        lo
    };
    // 立ち上がりごとの区間（フレーム番号の範囲と、区間の最初のフレームの入力位置）。前の区間と重なる・追い越すものは使わない
    let mut zones: Vec<(usize, usize, f64)> = Vec::new();
    for &o in onsets {
        // 立ち上がりが出力で来るべき時刻に、窓の中ほどが来るフレーム。窓の中ほどと立ち上がりの差の分だけ、入力の位置もずらす
        let t = output_of(o as f64);
        let k = ((t - n as f64 / 2.0) / hs as f64).round().max(0.0) as usize;
        if k < ZONE_BEFORE || k + ZONE_AFTER >= frames {
            continue;
        }
        let target = o as f64 - (t - (k * hs) as f64);
        let (k0, k1) = (k - ZONE_BEFORE, k + ZONE_AFTER);
        let p0 = target - (ZONE_BEFORE * hs) as f64;
        let p1 = p0 + ((k1 - k0) * hs) as f64;
        if p0 < 0.0 || p1 > last_pos as f64 {
            continue;
        }
        if let Some(&(prev_k0, prev_k1, prev_p0)) = zones.last() {
            let prev_p1 = prev_p0 + ((prev_k1 - prev_k0) * hs) as f64;
            // 区間どうしが重ならず、区間の間で入力が戻らない（単調）こと
            if k0 <= prev_k1 || p0 < prev_p1 {
                continue;
            }
        }
        zones.push((k0, k1, p0));
    }
    if zones.is_empty() {
        return;
    }
    // 区間の中は等倍、区間の間は前の区間の終わりと次の区間の始まりを直線でつなぐ
    let mut anchor_k = 0usize;
    let mut anchor_p = orig[0];
    for &(k0, k1, p0) in &zones {
        for k in anchor_k + 1..k0 {
            let g = (k - anchor_k) as f64 / (k0 - anchor_k) as f64;
            positions[k] = (anchor_p + (p0 - anchor_p) * g).round() as usize;
        }
        for k in k0..=k1 {
            positions[k] = (p0 + ((k - k0) * hs) as f64).round() as usize;
        }
        reset[k0] = true;
        anchor_k = k1;
        anchor_p = p0 + ((k1 - k0) * hs) as f64;
    }
    // 最後の区間の後は、元の対応の最後のフレームへ直線でつなぐ
    let last = frames - 1;
    for k in anchor_k + 1..=last {
        let g = (k - anchor_k) as f64 / (last - anchor_k).max(1) as f64;
        positions[k] = (anchor_p + (orig[last] - anchor_p) * g).round() as usize;
    }
}

/// 任意の時間対応 `map` で全チャンネルを伸縮する。
pub fn stretch_map(
    channels: &[&[f32]],
    map: &TimeMap,
    sample_rate: f32,
    progress: &mut dyn FnMut(f64),
) -> Vec<Vec<f32>> {
    stretch_map_with(channels, map, sample_rate, false, progress)
}

/// 立ち上がり保持付き（Phase Vocoder v2）の `stretch`
pub fn stretch2(channels: &[&[f32]], alpha: f64, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    if (alpha - 1.0).abs() < 1e-9 {
        return channels.iter().map(|c| c.to_vec()).collect();
    }
    let out_len = (len as f64 * alpha).round() as usize;
    stretch_map_with(channels, &TimeMap::linear(len, out_len), sample_rate, true, progress)
}

/// 立ち上がり保持付き（Phase Vocoder v2）の `stretch_map`
pub fn stretch_map2(channels: &[&[f32]], map: &TimeMap, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    stretch_map_with(channels, map, sample_rate, true, progress)
}

/// Phase Vocoder の本体。`transients` なら立ち上がりの山の位相を入力に戻す
fn stretch_map_with(
    channels: &[&[f32]],
    map: &TimeMap,
    sample_rate: f32,
    transients: bool,
    progress: &mut dyn FnMut(f64),
) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    let out_len = map.out_len;
    if len == 0 || out_len == 0 {
        return vec![Vec::new(); channels.len()];
    }

    let n = ((sample_rate * FRAME_SEC) as usize)
        .max(256)
        .next_power_of_two();
    let hs = n / OVERLAP;
    let bins = n / 2 + 1;
    let fft = Fft::new(n);
    let window: Vec<f32> = hann(n);

    // 末尾の扱いは WSOLA と同じ（`TimeMap::frame_pos` 参照）。
    let last_pos = len.saturating_sub(n) as f64;
    let frames = out_len / hs + 1;
    // 各出力フレームの入力の位置。立ち上がり保持なら、立ち上がりのまわりだけ伸ばさずに進める（`keep_transients`）
    let mut positions: Vec<usize> = (0..frames).map(|k| map.frame_pos(k * hs, len, n).round().clamp(0.0, last_pos) as usize).collect();
    // 位相を入力に戻すフレーム（立ち上がりの区間に入るところ）
    let mut reset = vec![false; frames];
    if transients {
        let onsets = detect_onsets(channels, &fft, &window, n, hs);
        keep_transients(&mut positions, &mut reset, &onsets, map, n, hs, last_pos as usize);
    }
    let pos_of = |k: usize| positions[k];

    let mut out = vec![vec![0.0f32; out_len + n]; channels.len()];
    let mut norm = vec![0.0f32; out_len + n];
    for k in 0..frames {
        for (i, &w) in window.iter().enumerate() {
            norm[k * hs + i] += w * w;
        }
    }

    let (mut re, mut im) = (vec![0.0f32; n], vec![0.0f32; n]);
    let mut xs = [vec![(0.0f32, 0.0f32); bins], vec![(0.0f32, 0.0f32); bins]];
    let mut ys = [vec![(0.0f32, 0.0f32); bins], vec![(0.0f32, 0.0f32); bins]];
    let mut peaks: Vec<usize> = Vec::with_capacity(bins);
    let mut rot: Vec<(f32, f32)> = Vec::with_capacity(bins);
    let total = (frames * channels.len()).max(1) as f64;
    let scale = 1.0 / n as f32;

    for (ci, x) in channels.iter().enumerate() {
        let mut st = ChannelState::new(bins, n);
        let mut prev_pos = 0usize;
        // 同じチャンネルの隣り合う2フレームを、実部と虚部に詰めて1回の FFT で変換する
        // （違うチャンネル同士を詰めると、大きな雑音の計算誤差が相方の静かな帯域に漏れて結果が揺れた）
        let mut k = 0;
        while k < frames {
            if k % 256 < 2 {
                progress((ci * frames + k) as f64 / total);
            }
            let two = k + 1 < frames;
            let (pa, pb) = (pos_of(k), if two { pos_of(k + 1) } else { 0 });
            for i in 0..n {
                re[i] = x.get(pa + i).copied().unwrap_or(0.0) * window[i];
                im[i] = if two { x.get(pb + i).copied().unwrap_or(0.0) * window[i] } else { 0.0 };
            }
            fft.run(&mut re, &mut im, false);
            // Z = X0 + i·X1 から、実信号2本のスペクトル X0・X1 を取り出す
            for bi in 0..bins {
                let j = (n - bi) % n;
                let (zr, zi, wr, wi) = (re[bi], im[bi], re[j], im[j]);
                xs[0][bi] = ((zr + wr) * 0.5, (zi - wi) * 0.5);
                xs[1][bi] = ((zi + wi) * 0.5, (wr - zr) * 0.5);
            }
            // 立ち上がりの区間に入るフレームは、位相を進めずに入力のまま使う（以降は等倍で進むので、ほぼ元の波形になる）
            advance(&mut st, &xs[0], &mut ys[0], k == 0 || reset[k], pa.saturating_sub(prev_pos), hs, n, &mut peaks, &mut rot);
            if two {
                advance(&mut st, &xs[1], &mut ys[1], reset[k + 1], pb.saturating_sub(pa), hs, n, &mut peaks, &mut rot);
            }
            prev_pos = if two { pb } else { pa };

            // エルミート対称な2本のスペクトル Y0・Y1 を Y0 + i·Y1 にまとめて逆変換する（実部が k、虚部が k+1 のフレーム）。
            // 位相を回すと直流とナイキストのビンに虚部が付くが、実信号ではこれは捨てる分（1本ずつ変換すれば
            // 逆変換の虚部に出て捨てられる）。まとめると相方に漏れるので、先に実数にしておく
            for y in ys.iter_mut() {
                y[0].1 = 0.0;
                y[bins - 1].1 = 0.0;
            }
            for bi in 0..n {
                let (y0, y1) = if bi < bins {
                    (ys[0][bi], if two { ys[1][bi] } else { (0.0, 0.0) })
                } else {
                    let (p, q) = (ys[0][n - bi], if two { ys[1][n - bi] } else { (0.0, 0.0) });
                    ((p.0, -p.1), (q.0, -q.1))
                };
                re[bi] = y0.0 - y1.1;
                im[bi] = y0.1 + y1.0;
            }
            fft.run(&mut re, &mut im, true);
            let o = &mut out[ci];
            for i in 0..n {
                let w = scale * window[i];
                o[k * hs + i] += re[i] * w;
                if two {
                    o[(k + 1) * hs + i] += im[i] * w;
                }
            }
            k += 2;
        }
    }

    for o in out.iter_mut() {
        o.truncate(out_len);
        for (s, &w) in o.iter_mut().zip(&norm) {
            *s = if w > 1e-3 { *s / w } else { 0.0 };
        }
    }
    out
}

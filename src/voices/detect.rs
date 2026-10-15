//! 和音を 2 つの声に分けるための、フレームごとの声（F0 と倍音の振幅）の推定

use super::{Voice, HOP, N_FFT};
use crate::stft::Stft;

/// 候補の F0 の範囲（Hz）と間隔（セント）
const F0_MIN: f32 = 70.0;
const F0_MAX: f32 = 1000.0;
const STEP_CENT: f32 = 10.0;
/// 倍音を見る上限（Hz）と、1 つの声の倍音の数の上限
const HARM_MAX_HZ: f32 = 6000.0;
const MAX_HARM: usize = 40;
/// 2 つ目の声とみなす顕著さの下限（1 つ目に対する割合）
const SECOND_RATIO: f32 = 0.25;

/// フレームごとの声（0〜2 個）を推定する
pub fn analyze(x: &[f32], sr: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<Voice>> {
    let mut st = Stft::new(N_FFT, HOP);
    let b = st.bins();
    let (mut re, mut im) = (vec![0.0; b], vec![0.0; b]);
    let frames = frame_count(x.len());
    let cands = candidates();
    let mut out = Vec::with_capacity(frames);
    for f in 0..frames {
        st.forward(x, f, &mut re, &mut im);
        let mut mag: Vec<f32> = re.iter().zip(&im).map(|(r, i)| (r * r + i * i).sqrt()).collect();
        out.push(frame_voices(&mut mag, sr, &cands, None));
        if f % 64 == 0 {
            progress(f as f64 * 0.9 / frames as f64);
        }
    }
    // 前後のフレームと続かない声（見逃しや、倍音を選んだ誤り）は、続いている声を残し、もう 1 つを前後の見込みの近くで探し直す
    let first: Vec<Vec<Voice>> = out.clone();
    for f in 0..frames {
        let Some((keep, hint)) = retry_plan(&first, f) else { continue };
        st.forward(x, f, &mut re, &mut im);
        let mut mag: Vec<f32> = re.iter().zip(&im).map(|(r, i)| (r * r + i * i).sqrt()).collect();
        let v = frame_voices_with(&mut mag, sr, &cands, keep, hint);
        if v.len() == 2 {
            out[f] = v;
        }
    }
    // 一瞬だけの外れ（前と後ろのフレームがそろって持つ声が、そのフレームだけない）も同じように探し直す
    let second: Vec<Vec<Voice>> = out.clone();
    for f in 1..frames.saturating_sub(1) {
        let Some((keep, hint)) = blip_plan(&second, f) else { continue };
        st.forward(x, f, &mut re, &mut im);
        let mut mag: Vec<f32> = re.iter().zip(&im).map(|(r, i)| (r * r + i * i).sqrt()).collect();
        let v = frame_voices_with(&mut mag, sr, &cands, keep, hint);
        if v.len() == 2 {
            out[f] = v;
        }
    }
    progress(1.0);
    out
}

/// 一瞬だけの外れを探し直すときの、残す声の F0 と、もう 1 つの声の見込み。前後 1 フレームだけを見る
fn blip_plan(frames: &[Vec<Voice>], f: usize) -> Option<(f32, f32)> {
    let close = |a: f32, b: f32| (1200.0 * (a / b).log2()).abs() < BLIP_CENT;
    let (prev, cur, next) = (&frames[f - 1], &frames[f], &frames[f + 1]);
    // 前と後ろがそろって持つ声
    let shared: Vec<f32> = prev.iter().filter_map(|p| next.iter().find(|n| close(p.f0, n.f0)).map(|n| (p.f0 * n.f0).sqrt())).collect();
    if shared.len() < 2 {
        return None;
    }
    let has = |g: f32| cur.iter().any(|c| close(c.f0, g));
    let missing: Vec<f32> = shared.iter().copied().filter(|&g| !has(g)).collect();
    let kept: Vec<f32> = shared.iter().copied().filter(|&g| has(g)).collect();
    match (kept.as_slice(), missing.as_slice()) {
        (&[k], &[m]) => Some((cur.iter().map(|c| c.f0).find(|&c| close(c, k))?, m)),
        _ => None,
    }
}

/// 一瞬だけの外れで、前後のフレームの声と同じとみなす範囲（セント）
const BLIP_CENT: f32 = 100.0;

/// 前後 `HINT_FRAMES` 以内のフレームのうち、`f0` から `HINT_CENT` 以内の声があるフレームの割合
fn support(frames: &[Vec<Voice>], f: usize, f0: f32) -> f32 {
    let r = f.saturating_sub(HINT_FRAMES)..(f + HINT_FRAMES + 1).min(frames.len());
    let n = r.len() - 1;
    let hit = r.filter(|&g| g != f && frames[g].iter().any(|v| (1200.0 * (v.f0 / f0).log2()).abs() < HINT_CENT)).count();
    if n > 0 { hit as f32 / n as f32 } else { 1.0 }
}

/// 探し直すときの、残す声の F0 と、もう 1 つの声の見込み。探し直さないなら None
fn retry_plan(frames: &[Vec<Voice>], f: usize) -> Option<(f32, f32)> {
    let v = &frames[f];
    let sup: Vec<f32> = v.iter().map(|x| support(frames, f, x.f0)).collect();
    // いちばん続いている声を残す。それも続いていなければ（音の変わり目など）、そのままにする
    let (ki, &ks) = sup.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1))?;
    if ks < SUPPORT_MIN || (v.len() == 2 && sup.iter().all(|&s| s >= SUPPORT_MIN)) {
        return None;
    }
    let keep = v[ki].f0;
    // 前と後ろのフレームそれぞれの、残す声から離れていて続いている声の F0 の中央値。音の変わり目で前後が食い違うなら探し直さない
    let median = |r: std::ops::Range<usize>| {
        let mut o: Vec<f32> = r
            .flat_map(|g| frames[g].iter().map(|x| x.f0))
            .filter(|&o| (1200.0 * (o / keep).log2()).abs() >= HINT_CENT && support(frames, f, o) >= SUPPORT_MIN)
            .collect();
        o.sort_by(|a, b| a.total_cmp(b));
        o.get(o.len() / 2).copied()
    };
    let before = median(f.saturating_sub(HINT_FRAMES)..f)?;
    let after = median(f + 1..(f + HINT_FRAMES + 1).min(frames.len()))?;
    ((1200.0 * (before / after).log2()).abs() < HINT_CENT).then(|| (keep, (before * after).sqrt()))
}

/// 続いているとみなす割合の下限
const SUPPORT_MIN: f32 = 0.4;

/// 2 つ目の声の見込みを探す、前後のフレーム数と範囲（セント）と、顕著さの下限（1 つ目に対する割合）
const HINT_FRAMES: usize = 12;
const HINT_CENT: f32 = 150.0;
const HINT_RATIO: f32 = 0.06;

fn frame_count(len: usize) -> usize {
    if len < N_FFT { 0 } else { (len - N_FFT) / HOP + 1 }
}

fn candidates() -> Vec<f32> {
    let n = (1200.0 * (F0_MAX / F0_MIN).log2() / STEP_CENT) as usize;
    (0..=n).map(|i| F0_MIN * 2f32.powf(i as f32 * STEP_CENT / 1200.0)).collect()
}

/// 周波数 `hz` のまわり ±1 ビンの最大の振幅
fn peak(mag: &[f32], hz: f32, bin_hz: f32) -> f32 {
    let k = (hz / bin_hz).round() as usize;
    if k + 1 >= mag.len() {
        return 0.0;
    }
    mag[k.saturating_sub(1)].max(mag[k]).max(mag[k + 1])
}

fn harm_count(f0: f32) -> usize {
    ((HARM_MAX_HZ / f0) as usize).clamp(1, MAX_HARM)
}

/// 倍音の振幅の重み付きの和（Klapuri 2006 の重み）
fn salience(mag: &[f32], f0: f32, bin_hz: f32) -> f32 {
    (1..=harm_count(f0)).map(|h| (f0 + 27.0) / (h as f32 * f0 + 320.0) * peak(mag, h as f32 * f0, bin_hz)).sum()
}

/// 倍音の山の位置から F0 を細かく求める（振幅で重みを付けた、山の周波数 ÷ 倍音の番号の平均）
fn refine(mag: &[f32], f0: f32, bin_hz: f32) -> f32 {
    let (mut sum, mut wsum) = (0.0, 0.0);
    for h in 1..=harm_count(f0).min(8) {
        let k = (h as f32 * f0 / bin_hz).round() as usize;
        if k < 2 || k + 2 >= mag.len() {
            continue;
        }
        let k = (k - 1..=k + 1).max_by(|&a, &b| mag[a].total_cmp(&mag[b])).unwrap();
        let (l, c, r) = (mag[k - 1], mag[k], mag[k + 1]);
        let d = if l - 2.0 * c + r < 0.0 { 0.5 * (l - r) / (l - 2.0 * c + r) } else { 0.0 };
        sum += c * (k as f32 + d) * bin_hz / h as f32;
        wsum += c;
    }
    if wsum > 0.0 { sum / wsum } else { f0 }
}

/// 窓（Hann）のスペクトルの主な山の形。中心からのずれ `d`（ビン）で、中心を 1 とする
pub(super) fn lobe(d: f32) -> f32 {
    if d.abs() >= 2.0 { 0.0 } else { 0.5 * (1.0 + (std::f32::consts::PI * d / 2.0).cos()) }
}

/// 顕著さが最大の候補。`avoid` の F0 から `AVOID_CENT` 以内は選ばない
fn best(mag: &[f32], cands: &[f32], bin_hz: f32, avoid: Option<f32>, near: Option<f32>) -> (f32, f32) {
    let cent = |f: f32, a: f32| (1200.0 * (f / a).log2()).abs();
    // 2 つ目は 1 つ目から `MAX_INTERVAL_CENT` 以内に限る。離れた候補の多くは、どちらかの声の 2、3 倍音を選んだ誤り（オクターブ以上離れたハモリは分けない）
    let ok = |f: f32| avoid.map_or(true, |a| cent(f, a) > AVOID_CENT && cent(f, a) < MAX_INTERVAL_CENT) && near.map_or(true, |n| cent(f, n) < HINT_CENT);
    cands.iter().filter(|&&f| ok(f)).map(|&f| (f, salience(mag, f, bin_hz))).fold((0.0, 0.0), |a, c| if c.1 > a.1 { c } else { a })
}

/// `f0` の倍音の顕著さのうち、`other` の倍音と重ならない倍音が占める割合
fn own_share(white: &[f32], f0: f32, other: f32, bin_hz: f32) -> f32 {
    let (mut own, mut all) = (0.0, 0.0);
    for h in 1..=harm_count(f0) {
        let hz = h as f32 * f0;
        let s = (f0 + 27.0) / (h as f32 * f0 + 320.0) * peak(white, hz, bin_hz);
        let m = (hz / other).round().max(1.0);
        if (hz - m * other).abs() / bin_hz >= OVERLAP_BIN {
            own += s;
        }
        all += s;
    }
    if all > 0.0 { own / all } else { 0.0 }
}

/// 2 つ目の声とみなす、1 つ目と重ならない倍音の割合の下限
const OWN_RATIO: f32 = 0.3;

/// 1 つ目の声が、基音の弱い声の 2、3 倍音を選んだ誤りなら直す。`f0` の 1/2、1/3 の高さの、`f0` の倍音に
/// ならない倍音（1/2 なら奇数番目）の顕著さが `f0` の `SUB_RATIO` 以上なら、低い方を選ぶ
fn lower_octave(white: &[f32], f0: f32, s: f32, bin_hz: f32) -> f32 {
    for d in [2usize, 3] {
        let g = f0 / d as f32;
        if g < F0_MIN {
            continue;
        }
        let own: f32 = (1..=harm_count(g)).filter(|h| h % d != 0).map(|h| (g + 27.0) / (h as f32 * g + 320.0) * peak(white, h as f32 * g, bin_hz)).sum();
        if own >= s * SUB_RATIO && salience(white, g, bin_hz) >= s * SUB_SALIENCE {
            return g;
        }
    }
    f0
}

/// 低い方に直す、`f0` の倍音にならない倍音の顕著さの下限（`f0` の顕著さに対する割合）
const SUB_RATIO: f32 = 0.3;
/// 低い方に直す、低い方の顕著さの下限（`f0` の顕著さに対する割合。1/3 の高さに下がりすぎないように）
const SUB_SALIENCE: f32 = 0.8;

/// 2 つ目の声を選ぶ、1 つ目からの音程の上限（セント。10 半音）
const MAX_INTERVAL_CENT: f32 = 1050.0;

/// 2 つ目の声に選ばない、1 つ目の F0 のまわり（セント）
const AVOID_CENT: f32 = 120.0;

/// 白色化（Klapuri 2006）: 周波数に比例した幅でならした大きさで割り、フォルマントによる偏りを減らす
fn whiten(mag: &[f32]) -> Vec<f32> {
    let mut acc = vec![0.0f32; mag.len() + 1];
    for (i, m) in mag.iter().enumerate() {
        acc[i + 1] = acc[i] + m;
    }
    (0..mag.len())
        .map(|k| {
            let w = (k / 6).max(8);
            let (lo, hi) = (k.saturating_sub(w), (k + w + 1).min(mag.len()));
            let mean = (acc[hi] - acc[lo]) / (hi - lo) as f32;
            mag[k] / (mean + 1e-9).powf(0.67)
        })
        .collect()
}

/// 倍音の振幅（スペクトルの滑らかさ: 前後の倍音との平均より大きい倍音は、ほかの声と重なったものとみなして抑える）
fn harmonic_amps(mag: &[f32], f0: f32, bin_hz: f32) -> Vec<f32> {
    let raw: Vec<f32> = (1..=harm_count(f0)).map(|h| peak(mag, h as f32 * f0, bin_hz)).collect();
    (0..raw.len())
        .map(|h| {
            let lo = h.saturating_sub(1);
            let hi = (h + 1).min(raw.len() - 1);
            let mean = raw[lo..=hi].iter().sum::<f32>() / (hi - lo + 1) as f32;
            raw[h].min(mean)
        })
        .collect()
}

fn subtract(mag: &mut [f32], f0: f32, amps: &[f32], bin_hz: f32) {
    for (h, a) in amps.iter().enumerate() {
        let c = (h + 1) as f32 * f0 / bin_hz;
        for k in (c - 2.0).max(0.0).ceil() as usize..=((c + 2.0) as usize).min(mag.len() - 1) {
            mag[k] = (mag[k] - a * lobe(k as f32 - c)).max(0.0);
        }
    }
}

/// 1 フレームの声を最大 2 つ選ぶ。選ぶのは白色化したスペクトルで、振幅は元のスペクトルから求める。`mag` は差し引いた残りになる。
/// `hint` があれば、2 つ目はその近くから低い基準で選ぶ
fn frame_voices(mag: &mut [f32], sr: f32, cands: &[f32], hint: Option<f32>) -> Vec<Voice> {
    let bin_hz = sr / N_FFT as f32;
    let orig = mag.to_vec();
    let mut voices = pick(mag, bin_hz, cands, hint, None);
    if voices.len() == 2 {
        resolve_overlap(&mut voices, &orig, bin_hz);
    }
    voices
}

/// 1 つ目を `keep` の F0 にして、2 つ目を `hint` の近くから選ぶ
fn frame_voices_with(mag: &mut [f32], sr: f32, cands: &[f32], keep: f32, hint: f32) -> Vec<Voice> {
    let bin_hz = sr / N_FFT as f32;
    let orig = mag.to_vec();
    let mut voices = pick(mag, bin_hz, cands, Some(hint), Some(keep));
    if voices.len() == 2 {
        resolve_overlap(&mut voices, &orig, bin_hz);
    }
    voices
}

/// 声を最大 2 つ選ぶ（`frame_voices` の本体）。`first_f0` があれば、1 つ目はその F0 にする
fn pick(mag: &mut [f32], bin_hz: f32, cands: &[f32], hint: Option<f32>, first_f0: Option<f32>) -> Vec<Voice> {
    let mut white = whiten(mag);
    let orig_white = white.clone();
    let floor = white.iter().fold(0.0f32, |a, &m| a.max(m)) * 1e-3;
    let mut voices: Vec<Voice> = Vec::new();
    let mut first = 0.0;
    for i in 0..2 {
        let near = if i == 1 { hint } else { None };
        let ratio = if near.is_some() { HINT_RATIO } else { SECOND_RATIO };
        let (f0, s) = match first_f0.filter(|_| i == 0) {
            Some(f) => (f, salience(&white, f, bin_hz).max(floor * 2.0)),
            None => best(&white, cands, bin_hz, voices.first().map(|v| v.f0), near),
        };
        if s <= floor || (i == 1 && s < first * ratio) {
            break;
        }
        if i == 0 {
            first = s;
        }
        let f0 = if i == 0 && first_f0.is_none() { lower_octave(&white, f0, s, bin_hz) } else { f0 };
        let f0 = if i == 0 && first_f0.is_some() { f0 } else { refine(mag, f0, bin_hz) };
        // 2 つ目の倍音の多くが 1 つ目の倍音と重なるなら（1 つ目の 2 倍の高さなど）、1 つ目の差し引き残りとみなす
        if let Some(v) = voices.first() {
            if own_share(&orig_white, f0, v.f0, bin_hz) < OWN_RATIO {
                break;
            }
        }
        let wamps = harmonic_amps(&white, f0, bin_hz);
        subtract(&mut white, f0, &wamps, bin_hz);
        let amps = harmonic_amps(mag, f0, bin_hz);
        subtract(mag, f0, &amps, bin_hz);
        voices.push(Voice { f0, spread: 0.0, amps });
    }
    voices
}

/// 重なった倍音を分ける。2 つの声の振幅を元のスペクトルから求め直し、もう一方の声の倍音と
/// `OVERLAP_BIN` 以内で重なる倍音は、同じ声の重ならない前後の倍音から直線で補った値にする（5 度、8 度で効く）
fn resolve_overlap(voices: &mut [Voice], orig: &[f32], bin_hz: f32) {
    let f = [voices[0].f0, voices[1].f0];
    for i in 0..2 {
        let other = f[1 - i];
        let n = voices[i].amps.len();
        let raw: Vec<f32> = (1..=n).map(|h| peak(orig, h as f32 * f[i], bin_hz)).collect();
        let overlapped: Vec<bool> = (1..=n)
            .map(|h| {
                let hz = h as f32 * f[i];
                let m = (hz / other).round().max(1.0);
                (hz - m * other).abs() / bin_hz < OVERLAP_BIN
            })
            .collect();
        let near = |h: usize, step: isize| {
            let mut j = h as isize + step;
            while j >= 0 && (j as usize) < n {
                if !overlapped[j as usize] {
                    return Some((j as usize, raw[j as usize]));
                }
                j += step;
            }
            None
        };
        voices[i].amps = (0..n)
            .map(|h| {
                if !overlapped[h] {
                    return raw[h];
                }
                let guess = match (near(h, -1), near(h, 1)) {
                    (Some((a, x)), Some((b, y))) => x + (y - x) * (h - a) as f32 / (b - a) as f32,
                    (Some((_, x)), None) | (None, Some((_, x))) => x,
                    // すべて重なる（8 度の高い方）: 今までどおり滑らかさで抑えた値
                    (None, None) => voices[i].amps[h],
                };
                guess.min(raw[h])
            })
            .collect();
    }
}

/// 重なったとみなす倍音どうしの距離（ビン）
const OVERLAP_BIN: f32 = 1.5;

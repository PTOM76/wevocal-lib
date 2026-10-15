//! 和音を 2 つの声に分ける（試作。WeVocalSynth と WeVocal Studio で共通）。
//!
//! フレームごとに、倍音の振幅の重み付きの和（顕著さ）が最大の F0 を 1 つ目の声とし、その倍音を
//! スペクトルの滑らかさで抑えてから差し引き、残りからもう 1 つ選ぶ（Klapuri 2003 / 2006）。
//! 2 つの声を高さか音量で出力 A・B に振り分け、倍音の見込みの比のマスクで分ける。
//! 元の位相のまま戻し、マスクの和は 1 なので、A + B は元の音と一致する。

mod detect;

pub use detect::analyze;
use detect::lobe;
use crate::stft::Stft;

pub(crate) const N_FFT: usize = 4096;
pub(crate) const HOP: usize = 512;
/// マスクで分ける STFT の窓の長さ。推定より短くすると音の変わり目に強くなるはずだが、2048 は合成の声で約 0.5dB 悪く、
/// 実際の曲では聞いて違いが分からなかった（2026-10-08）
const MASK_FFT: usize = N_FFT;
/// マスクの中央値をとるフレーム数（推定のフレームで前後）
const MASK_MEDIAN: usize = 2;
/// 音量で振り分けるとき、大きさをならすフレーム数（前後）
const SMOOTH: usize = 8;

/// 振り分けの基準
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum SplitBy {
    /// A が高い方
    Pitch,
    /// A が大きい方
    Volume,
}

/// 1 フレームの 1 つの声
#[derive(Clone, Debug)]
pub struct Voice {
    pub f0: f32,
    /// 窓の長さの間の F0 の動き（Hz。マスクの山の幅を広げる）
    pub spread: f32,
    /// 倍音ごとの振幅（1 倍音から）
    pub amps: Vec<f32>,
}

impl Voice {
    fn energy(&self) -> f32 {
        self.amps.iter().map(|a| a * a).sum()
    }
}

/// `x` を 2 つの声に分ける（A, B）。`x` が複数チャンネルでも、推定はチャンネルを混ぜた音で行う
pub fn split(channels: &[&[f32]], sr: f32, by: SplitBy, progress: &mut dyn FnMut(f64)) -> (Vec<Vec<f32>>, Vec<Vec<f32>>) {
    let len = channels.first().map_or(0, |c| c.len());
    // 端のフレームも窓が重なりきるように、前後を N_FFT だけ延ばす
    let pad = |c: &[f32]| {
        let mut v = vec![0.0; len + 2 * N_FFT];
        v[N_FFT..N_FFT + len].copy_from_slice(c);
        v
    };
    let padded: Vec<Vec<f32>> = channels.iter().map(|c| pad(c)).collect();
    let mut mono = vec![0.0; len + 2 * N_FFT];
    for c in &padded {
        for (m, s) in mono.iter_mut().zip(c) {
            *m += s / channels.len() as f32;
        }
    }
    // 進み具合は、推定が前半、マスクで分けるのが後半（チャンネルごと）
    let voices = analyze(&mono, sr, &mut |p| progress(p * 0.5));
    let mut assigned = assign(&voices, by);
    add_spread(&mut assigned);
    let m_fft = MASK_FFT;
    let m_hop = m_fft / 8;
    let mut st = Stft::new(m_fft, m_hop);
    let b = st.bins();
    let bin_hz = sr / m_fft as f32;
    let frames = (mono.len() - m_fft) / m_hop + 1;
    // マスクのフレームの中心の時刻に、推定のフレームの声を補って合わせる
    let at = |g: usize| voices_at(&assigned, (g * m_hop + m_fft / 2) as f32, m_fft as f32 / N_FFT as f32);
    let radius = MASK_MEDIAN * HOP / m_hop;
    let (mut re, mut im) = (vec![0.0; b], vec![0.0; b]);
    let (mut ra, mut ia, mut rb, mut ib) = (vec![0.0; b], vec![0.0; b], vec![0.0; b], vec![0.0; b]);
    let mut outs = (Vec::new(), Vec::new());
    let nch = padded.len() as f64;
    for (ci, c) in padded.iter().enumerate() {
        let (mut ya, mut yb, mut w) = (vec![0.0; c.len()], vec![0.0; c.len()], vec![0.0; c.len()]);
        // 前後 `radius` フレームのマスク（一瞬だけの振り分けの外れを、ビンごとの中央値で消す）
        let raw = |g: usize| {
            let (va, vb) = at(g);
            mask_a(va.as_ref(), vb.as_ref(), b, bin_hz)
        };
        // `ring` は `start` からのフレームのマスク。フレーム f では f - radius 〜 f + radius を持つ
        let mut ring: std::collections::VecDeque<Vec<f32>> = std::collections::VecDeque::new();
        let mut start = 0;
        let mut mask = vec![0.0f32; b];
        let mut vals = Vec::with_capacity(2 * radius + 1);
        for f in 0..frames {
            while start + ring.len() <= (f + radius).min(frames - 1) {
                ring.push_back(raw(start + ring.len()));
            }
            while start + radius < f {
                ring.pop_front();
                start += 1;
            }
            for k in 0..b {
                vals.clear();
                vals.extend(ring.iter().map(|m| m[k]));
                vals.sort_by(|a, b| a.total_cmp(b));
                mask[k] = vals[vals.len() / 2];
            }
            st.forward(c, f, &mut re, &mut im);
            for k in 0..b {
                ra[k] = re[k] * mask[k];
                ia[k] = im[k] * mask[k];
                rb[k] = re[k] - ra[k];
                ib[k] = im[k] - ia[k];
            }
            st.inverse_add(&ra, &ia, f, &mut ya, Some(&mut w));
            st.inverse_add(&rb, &ib, f, &mut yb, None);
            if f % 64 == 0 {
                progress(0.5 + 0.5 * (ci as f64 + f as f64 / frames as f64) / nch);
            }
        }
        let norm = |y: &[f32]| (0..len).map(|i| y[N_FFT + i] / w[N_FFT + i].max(1e-6)).collect::<Vec<f32>>();
        outs.0.push(norm(&ya));
        outs.1.push(norm(&yb));
    }
    progress(1.0);
    outs
}


/// 各フレームの声を A・B に振り分ける
fn assign(frames: &[Vec<Voice>], by: SplitBy) -> Vec<(Option<Voice>, Option<Voice>)> {
    // 前のフレームの F0 に近い方へつなぐ（2 つの軌跡）
    let mut tracks: Vec<[Option<Voice>; 2]> = Vec::with_capacity(frames.len());
    let mut last = [0.0f32; 2];
    for v in frames {
        let dist = |f: f32, l: f32| if l > 0.0 { (f / l).log2().abs() } else { 0.5 };
        let mut slot: [Option<Voice>; 2] = [None, None];
        match v.len() {
            0 => {}
            1 => {
                let i = if dist(v[0].f0, last[0]) <= dist(v[0].f0, last[1]) { 0 } else { 1 };
                slot[i] = Some(v[0].clone());
            }
            _ => {
                let keep = dist(v[0].f0, last[0]) + dist(v[1].f0, last[1]);
                let swap = dist(v[0].f0, last[1]) + dist(v[1].f0, last[0]);
                let (a, b) = if keep <= swap { (0, 1) } else { (1, 0) };
                slot = [Some(v[a].clone()), Some(v[b].clone())];
            }
        }
        for i in 0..2 {
            if let Some(s) = &slot[i] {
                last[i] = s.f0;
            }
        }
        tracks.push(slot);
    }
    let energy: Vec<[f32; 2]> = tracks.iter().map(|t| [0, 1].map(|i| t[i].as_ref().map_or(0.0, |v| v.energy()))).collect();
    let mut out: Vec<(Option<Voice>, Option<Voice>)> = (0..tracks.len())
        .map(|f| {
            let [s0, s1] = tracks[f].clone();
            let first_is_a = match by {
                SplitBy::Pitch => match (&s0, &s1) {
                    (Some(a), Some(b)) => a.f0 >= b.f0,
                    _ => last_pitch_order(&tracks, f),
                },
                SplitBy::Volume => {
                    let r = f.saturating_sub(SMOOTH)..(f + SMOOTH + 1).min(tracks.len());
                    let e0: f32 = energy[r.clone()].iter().map(|e| e[0]).sum();
                    let e1: f32 = energy[r].iter().map(|e| e[1]).sum();
                    e0 >= e1
                }
            };
            if first_is_a { (s0, s1) } else { (s1, s0) }
        })
        .collect();
    merge_same_singer(&mut out);
    out
}

/// 音の変わり目で、同じ人の前の音の終わりと次の音が重なって 2 声に見えるフレームは、2 つとも同じ出力に入れる。
/// 片方の声が、ある出力の直前（`RECENT` フレーム以内）の高さにつながり、もう片方が新しく始まった音で、その出力の方に近く、
/// もう一方の出力の声が小さくなっているときに、そうみなす
fn merge_same_singer(frames: &mut [(Option<Voice>, Option<Voice>)]) {
    // 出力ごとの、直前の声（フレーム、F0、大きさ）と、`RECENT` フレーム以内の最大の大きさ
    let mut hist: [Vec<(usize, f32, f32)>; 2] = [Vec::new(), Vec::new()];
    let d = |a: f32, b: f32| (a / b).log2().abs();
    for f in 0..frames.len() {
        let recent = |i: usize| hist[i].last().filter(|&&(g, _, _)| f - g <= RECENT).copied();
        let peak = |i: usize| hist[i].iter().rev().take_while(|&&(g, _, _)| f - g <= 2 * RECENT).map(|x| x.2).fold(0.0f32, f32::max);
        // 2 フレーム以内の声が、最近の最大より `FADE` 以上小さい（その人が音を終えかけている）。途切れているだけでは見ない
        // （まとめたフレームではその出力の記録が止まるので、途切れを条件にするとまとめ続けてしまう）
        let fading = |i: usize| recent(i).is_some_and(|(g, _, e)| f - g <= 2 && e < peak(i) * FADE);
        // 出力ごとの最近の高さ（一瞬だけの誤った F0 に引きずられないように、`2 * RECENT` フレーム以内の中央値）
        let pitch = |i: usize| {
            let mut p: Vec<f32> = hist[i].iter().rev().take_while(|&&(g, _, _)| f - g <= 2 * RECENT).map(|x| x.1).collect();
            p.sort_by(|a, b| a.total_cmp(b));
            p.get(p.len() / 2).copied()
        };
        let merged = match (&frames[f], recent(0).and(pitch(0)), recent(1).and(pitch(1))) {
            ((Some(a), Some(b)), Some(pa), Some(pb)) => {
                // 片方がその出力の直前の高さにつながり、もう片方はどちらにもつながらない（新しく始まった音）で、そちらに近い
                let link = |x: f32, p: f32| d(x, p) < LINK_OCT;
                let new_note = |x: f32| !link(x, pa) && !link(x, pb);
                let to = |p: f32, q: f32| {
                    (link(a.f0, p) && new_note(b.f0) && d(b.f0, p) < d(b.f0, q)) || (link(b.f0, p) && new_note(a.f0) && d(a.f0, p) < d(a.f0, q))
                };
                let (to_a, to_b) = (to(pa, pb) && fading(1), to(pb, pa) && fading(0));
                // マスクは声のない出力に何も入れないので、片方を空にすれば 2 つとも残る方に入る
                if to_a {
                    frames[f].1 = None;
                } else if to_b {
                    frames[f].0 = None;
                }
                to_a || to_b
            }
            _ => false,
        };
        // まとめたフレームは、残った出力に 2 声あるので記録しない
        if !merged {
            for (i, v) in [&frames[f].0, &frames[f].1].into_iter().enumerate() {
                if let Some(v) = v {
                    hist[i].push((f, v.f0, v.energy()));
                }
            }
        }
    }
}

/// 同じ人の前後の音とみなすときに見る、直前のフレーム数と、直前の高さにつながるとみなす範囲（オクターブ。100 セント）
const RECENT: usize = 10;
const LINK_OCT: f32 = 100.0 / 1200.0;
/// 音を終えかけているとみなす、最近の最大に対する大きさ（-6dB）
const FADE: f32 = 0.25;

/// 時刻 `center`（サンプル）の A、B の声。前後の推定のフレームの声を直線で補う（同じ出力に近い高さの声があるときだけ）。
/// `scale` はマスクの窓の長さの、推定の窓に対する比（F0 の動きの幅を合わせる）
fn voices_at(frames: &[(Option<Voice>, Option<Voice>)], center: f32, scale: f32) -> (Option<Voice>, Option<Voice>) {
    let pos = ((center - N_FFT as f32 / 2.0) / HOP as f32).clamp(0.0, (frames.len() - 1) as f32);
    let (i, t) = (pos.floor() as usize, pos.fract());
    let j = (i + 1).min(frames.len() - 1);
    let mix = |a: &Option<Voice>, b: &Option<Voice>| -> Option<Voice> {
        let near = match (a, b) {
            (Some(x), Some(y)) if (x.f0 / y.f0).log2().abs() < 0.1 => Some((x, y)),
            _ => None,
        };
        let mut v = match near {
            Some((x, y)) => Voice {
                f0: x.f0 + (y.f0 - x.f0) * t,
                spread: x.spread + (y.spread - x.spread) * t,
                amps: x.amps.iter().zip(y.amps.iter().chain(std::iter::repeat(&0.0))).map(|(p, q)| p + (q - p) * t).collect(),
            },
            None => if t < 0.5 { a.clone()? } else { b.clone()? },
        };
        v.spread *= scale;
        Some(v)
    };
    (mix(&frames[i].0, &frames[j].0), mix(&frames[i].1, &frames[j].1))
}

/// 各声に、前後のフレームの同じ出力の F0 から、窓の長さの間の F0 の動きを入れる
fn add_spread(frames: &mut [(Option<Voice>, Option<Voice>)]) {
    let f0s: Vec<[Option<f32>; 2]> = frames.iter().map(|(a, b)| [a.as_ref().map(|v| v.f0), b.as_ref().map(|v| v.f0)]).collect();
    // 窓の実効的な長さは、間隔の約 4 つ分
    let hops = N_FFT as f32 / HOP as f32 / 2.0;
    for (f, (a, b)) in frames.iter_mut().enumerate() {
        for (i, v) in [a, b].into_iter().enumerate() {
            let Some(v) = v else { continue };
            let near = |g: Option<usize>| g.and_then(|g| f0s.get(g)).and_then(|x| x[i]).filter(|p| (p / v.f0).log2().abs() < 0.1);
            let d = [near(f.checked_sub(1)), near(Some(f + 1))].iter().flatten().map(|p| (p - v.f0).abs()).fold(0.0f32, f32::max);
            v.spread = d * hops;
        }
    }
}

/// 1 声のフレームで、軌跡 0 を高い方とみなすか（最も近い 2 声のフレームの上下に合わせる）
fn last_pitch_order(tracks: &[[Option<Voice>; 2]], f: usize) -> bool {
    let both = |t: &[Option<Voice>; 2]| match t {
        [Some(a), Some(b)] => Some(a.f0 >= b.f0),
        _ => None,
    };
    (1..tracks.len())
        .find_map(|d| f.checked_sub(d).and_then(|i| both(&tracks[i])).or_else(|| tracks.get(f + d).and_then(both)))
        .unwrap_or(true)
}

/// ビンごとの A の割合
fn mask_a(a: Option<&Voice>, b: Option<&Voice>, bins: usize, bin_hz: f32) -> Vec<f32> {
    let model = |v: Option<&Voice>| {
        let mut e = vec![0.0f32; bins];
        if let Some(v) = v {
            for (h, amp) in v.amps.iter().enumerate() {
                let c = (h + 1) as f32 * v.f0 / bin_hz;
                // F0 が動くと、倍音の山は倍音の番号に比例した幅でにじむ（山の上を平らに広げる）
                let half = 0.5 * (h + 1) as f32 * v.spread / bin_hz;
                for k in (c - 2.0 - half).max(0.0).ceil() as usize..=((c + 2.0 + half) as usize).min(bins - 1) {
                    e[k] += amp * lobe(((k as f32 - c).abs() - half).max(0.0));
                }
            }
        }
        e
    };
    let (ea, eb) = (model(a), model(b));
    let (pa, pb) = (a.map_or(0.0, |v| v.energy()), b.map_or(0.0, |v| v.energy()));
    // 倍音から離れたビンは、両声の大きさの比で分ける
    let share = if pa + pb > 0.0 { pa / (pa + pb) } else { 0.5 };
    let delta = ea.iter().chain(&eb).fold(0.0f32, |m, &e| m.max(e * e)) * 1e-3 + 1e-12;
    (0..bins).map(|k| (ea[k] * ea[k] + share * delta) / (ea[k] * ea[k] + eb[k] * eb[k] + delta)).collect()
}

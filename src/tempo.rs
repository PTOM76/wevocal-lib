//! テンポ（BPM）の自動解析。
//!
//! 1. 短い区間ごとにスペクトルを求める
//! 2. 各周波数で振幅が増えた分だけを足し合わせ、時刻ごとの「音量の増加量」（オンセット強度）にする
//!    （音は主に拍の頭で鳴り始めるので、拍の間隔で増加量が大きくなる）
//! 3. 増加量の時間方向の周波数成分を BPM の候補ごとに求める（120 BPM なら 2Hz の成分が大きい）
//!
//! 一番大きい成分は、正しいテンポか、その 2 倍・0.5 倍になりやすい。0.75 倍・1.5 倍などになることもあるため、
//! 候補を強い順に複数返し、選ぶのは画面側に任せる。1拍目の位置は、選んだテンポの成分の位相から求める。

use crate::fft::Fft;
use std::f64::consts::PI;
use crate::window::hann;

/// スペクトルを求める区間の長さ（サンプル、2 のべき乗）
const FRAME: usize = 1024;
/// オンセット強度の時間間隔（秒）
pub const HOP_SEC: f64 = 0.01;
/// 探すテンポの範囲と刻み（BPM）
const MIN_BPM: f64 = 40.0;
const MAX_BPM: f64 = 240.0;
const STEP_BPM: f64 = 0.1;
/// 返す候補の数
const CANDIDATES: usize = 6;
/// 候補の BPM を詰めるときに探す幅と刻み（BPM）と、足し合わせる倍音の数
const REFINE_RANGE: f64 = 0.6;
const REFINE_STEP: f64 = 0.01;
const REFINE_HARMONICS: usize = 4;
/// 振幅の圧縮の強さ（log(1 + C·振幅)）。小さい音の立ち上がりも拾えるようにする
const COMPRESS: f32 = 100.0;

/// テンポの候補（BPM、強さ（一番強い候補を 1 とした比）、その BPM での1拍目の位置（秒））
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Candidate {
    pub bpm: f64,
    pub strength: f64,
    pub offset: f64,
}

/// モノラル信号 `x` のオンセット強度（`HOP_SEC` 間隔）
pub fn onset_envelope(x: &[f32], sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<f32> {
    let hop = ((sample_rate as f64 * HOP_SEC).round() as usize).max(1);
    let frames = x.len() / hop + 1;
    let bins = FRAME / 2 + 1;
    let fft = Fft::new(FRAME);
    let window: Vec<f32> = hann(FRAME);
    let (mut re, mut im) = (vec![0.0f32; FRAME], vec![0.0f32; FRAME]);
    let mut prev = vec![0.0f32; bins];
    let mut env = vec![0.0f32; frames];
    for (k, e) in env.iter_mut().enumerate() {
        if k % 2000 == 0 {
            progress(k as f64 / frames as f64 * 0.8);
        }
        let start = (k * hop) as i64 - (FRAME / 2) as i64;
        for i in 0..FRAME {
            let s = start + i as i64;
            re[i] = if s >= 0 && (s as usize) < x.len() { x[s as usize] * window[i] } else { 0.0 };
            im[i] = 0.0;
        }
        fft.run(&mut re, &mut im, false);
        let mut flux = 0.0f32;
        for b in 0..bins {
            let m = (1.0 + COMPRESS * (re[b] * re[b] + im[b] * im[b]).sqrt()).ln();
            // 増えた分だけを足す（減った分は拍の頭と関係が薄い）
            flux += (m - prev[b]).max(0.0);
            prev[b] = m;
        }
        *e = flux;
    }
    env
}

/// オンセット強度 `env` から、テンポの候補（強い順）を求める
pub fn estimate(env: &[f32], progress: &mut dyn FnMut(f64)) -> Vec<Candidate> {
    if env.len() < 4 {
        return Vec::new();
    }
    // 平均を引き、ゆっくりした音量の変化（数秒単位）を取り除く
    let mean = env.iter().map(|&v| v as f64).sum::<f64>() / env.len() as f64;
    let n = env.len();
    // 端で切れることによる漏れ（ピークの位置がずれる）を抑えるため Hann 窓をかける
    let x: Vec<f64> = env.iter().enumerate().map(|(k, &v)| (v as f64 - mean) * (0.5 - 0.5 * (2.0 * PI * k as f64 / n as f64).cos())).collect();
    // 拍の頭の位置（offset）は、窓をかける前の信号の位相で求める（窓をかけると時間方向の重みが変わり、位相の基準がずれる）
    let raw: Vec<f64> = env.iter().map(|&v| v as f64 - mean).collect();

    let steps = ((MAX_BPM - MIN_BPM) / STEP_BPM).round() as usize + 1;
    // 各 BPM での周波数成分の大きさ
    let mut mag = Vec::with_capacity(steps);
    for s in 0..steps {
        if s % 200 == 0 {
            progress(0.8 + 0.15 * s as f64 / steps as f64);
        }
        let (re, im) = component(&x, MIN_BPM + s as f64 * STEP_BPM);
        mag.push((re * re + im * im).sqrt());
    }

    // 山（両隣より大きい所）を強い順に取る
    let mut peaks: Vec<usize> = (1..steps - 1).filter(|&i| mag[i] > mag[i - 1] && mag[i] >= mag[i + 1]).collect();
    peaks.sort_by(|&a, &b| mag[b].total_cmp(&mag[a]));
    let top = peaks.first().map_or(0.0, |&i| mag[i]).max(1e-12);
    let out = peaks
        .iter()
        .take(CANDIDATES)
        .map(|&i| {
            let bpm = refine(&x, MIN_BPM + i as f64 * STEP_BPM);
            let (re, im) = component(&raw, bpm);
            Candidate { bpm: (bpm * 100.0).round() / 100.0, strength: mag[i] / top, offset: beat_offset(bpm, re, im) }
        })
        .collect();
    progress(1.0);
    out
}

/// 信号 `x`（`HOP_SEC` 間隔）の、`bpm` の拍の速さの周波数成分（複素数）
fn component(x: &[f64], bpm: f64) -> (f64, f64) {
    let w = 2.0 * PI * (bpm / 60.0) * HOP_SEC;
    // 回転を掛け算で進める（毎回 sin/cos を呼ばない）
    let (cw, sw) = (w.cos(), w.sin());
    let (mut c, mut si) = (1.0f64, 0.0f64);
    let (mut re, mut im) = (0.0f64, 0.0f64);
    for (k, &v) in x.iter().enumerate() {
        re += v * c;
        im -= v * si;
        let nc = c * cw - si * sw;
        si = si * cw + c * sw;
        c = nc;
        // 丸め誤差で振幅がずれないよう、ときどき正規化する
        if k % 1024 == 1023 {
            let n = (c * c + si * si).sqrt();
            c /= n;
            si /= n;
        }
    }
    (re, im)
}

/// 候補の BPM を詰める。まわり ±`REFINE_RANGE` を細かく探し、拍の速さの成分と、その倍音（2〜4 倍）の大きさの和が最大の所にする。
/// 倍音は同じずれでもピークの位置が大きく動くので、基本の成分だけより細かく決まる。最後に放物線で補間する
fn refine(x: &[f64], bpm: f64) -> f64 {
    let score = |b: f64| (1..=REFINE_HARMONICS).map(|h| { let (re, im) = component(x, b * h as f64); (re * re + im * im).sqrt() }).sum::<f64>();
    let steps = (2.0 * REFINE_RANGE / REFINE_STEP).round() as usize;
    let at = |s: usize| bpm - REFINE_RANGE + s as f64 * REFINE_STEP;
    let scores: Vec<f64> = (0..=steps).map(|s| score(at(s))).collect();
    let best = (0..=steps).max_by(|&a, &b| scores[a].total_cmp(&scores[b])).unwrap_or(steps / 2);
    if best == 0 || best == steps {
        return at(best);
    }
    // 放物線の頂点（両隣との差から）
    let (l, c, r) = (scores[best - 1], scores[best], scores[best + 1]);
    let denom = l - 2.0 * c + r;
    let shift = if denom.abs() > 1e-12 { 0.5 * (l - r) / denom } else { 0.0 };
    at(best) + shift.clamp(-0.5, 0.5) * REFINE_STEP
}

/// 周波数成分の位相から、最初の拍の時刻（秒、0〜1拍の長さ）を求める。
/// 成分 re + i·im は cos(ωt + φ) の形の波で、その山（φ + ωt = 0 mod 2π）が拍の頭
fn beat_offset(bpm: f64, re: f64, im: f64) -> f64 {
    let beat = 60.0 / bpm;
    let phase = im.atan2(re);
    // 山の時刻 t = -φ / ω を 0〜1拍に収める
    let t = -phase / (2.0 * PI / beat);
    t.rem_euclid(beat)
}

/// テンポの候補を BPM で探しやすいよう、`bpm` の拍の長さ（秒）
pub fn beat_sec(bpm: f64) -> f64 {
    60.0 / bpm
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `bpm` で鳴るクリック（短い減衰音）と、弱い持続音を混ぜた信号。1拍目は `offset` 秒
    fn clicks(bpm: f64, offset: f64, secs: f64, sr: f32) -> Vec<f32> {
        let n = (secs * sr as f64) as usize;
        let beat = 60.0 / bpm;
        let mut x: Vec<f32> = (0..n).map(|i| 0.05 * (i as f32 * 2.0 * std::f32::consts::PI * 330.0 / sr).sin()).collect();
        let mut t = offset;
        while t < secs {
            let s = (t * sr as f64) as usize;
            for j in 0..(sr as usize / 20) {
                if s + j < n {
                    let env = (-(j as f32) / (sr * 0.01)).exp();
                    x[s + j] += env * (j as f32 * 2.0 * std::f32::consts::PI * 1000.0 / sr).sin();
                }
            }
            t += beat;
        }
        x
    }

    #[test]
    fn finds_tempo_and_offset() {
        let sr = 44100.0;
        for (bpm, offset) in [(120.0, 0.13), (97.0, 0.3), (150.0, 0.05)] {
            let x = clicks(bpm, offset, 20.0, sr);
            let env = onset_envelope(&x, sr, &mut |_| {});
            let cands = estimate(&env, &mut |_| {});
            let off = cands[0].offset;
            let best = cands[0].bpm;
            // 一番強い候補は正解か、その 2 倍・0.5 倍
            let ok = [bpm, bpm * 2.0, bpm / 2.0].iter().any(|&b| (best - b).abs() < 0.6);
            assert!(ok, "bpm {bpm}: best {best} ({cands:?})");
            // 候補のどれかに正解が入っている
            assert!(cands.iter().any(|c| (c.bpm - bpm).abs() < 0.6), "bpm {bpm}: {cands:?}");
            // 1拍目の位置は、一番強い候補の拍の長さで見て正解と揃っている（20ms 以内）
            let b = beat_sec(best);
            let d = ((off - offset).rem_euclid(b)).min((offset - off).rem_euclid(b));
            assert!(d < 0.02, "bpm {bpm}: offset {off} expected {offset}");
        }
    }

    /// 小数のテンポも細かく当たる（以前は 0.1 刻みの基本の成分だけで、0.5 ほどずれることがあった）
    #[test]
    fn fractional_tempo_is_precise() {
        let sr = 44100.0;
        // 138 は、以前 137.4 と出ていた例
        for bpm in [123.4, 97.7, 140.25, 88.8, 138.0] {
            let x = clicks(bpm, 0.1, 30.0, sr);
            let env = onset_envelope(&x, sr, &mut |_| {});
            let cands = estimate(&env, &mut |_| {});
            let near = cands.iter().map(|c| (c.bpm - bpm).abs()).fold(f64::MAX, f64::min);
            println!("bpm {bpm}: {:?}", cands.iter().map(|c| c.bpm).collect::<Vec<_>>());
            assert!(near < 0.1, "bpm {bpm}: nearest error {near} ({cands:?})");
        }
    }
}

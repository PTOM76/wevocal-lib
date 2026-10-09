//! スペクトル包絡（フォルマント）補正。
//!
//! 本エンジンのピッチ変更は「伸縮してから r 倍速でリサンプル」であり、リサンプルは
//! フォルマントを含むスペクトル全体を r 倍に動かしてしまう。フォルマントを保持（または
//! 独立に移動）するため、リサンプル *前* の伸縮済み信号をフレームごとにフィルタし、
//! 包絡を E(c·f) に変形しておく。E はそのフレーム自身の包絡、
//! c = ピッチ比 / フォルマント比。r 倍のリサンプル後、包絡は E(f / フォルマント比) となり、
//! フォルマント比 = 1 なら元の包絡のまま保たれる。
//!
//! 包絡はケプストラムで平滑化した対数スペクトル。リフタのカットオフはフレームごとの
//! ピッチ周期（ケプストラムのピーク）に追従させ、低い声でも高い声でも倍音成分を
//! 取り除けるようにしている。

use crate::fft::Fft;
use std::sync::atomic::{AtomicBool, Ordering};
use crate::window::hann;

/// 対数・指数に速い近似（`fast_ln` / `fast_exp`）を使うか。既定は使う。設定（開発者向け）で標準の関数に切り替えて聴き比べられる
static FAST_MATH: AtomicBool = AtomicBool::new(true);

/// 速い近似を使うかを切り替える（Worker が処理の前に設定の値を入れる）
pub fn set_fast_math(on: bool) {
    FAST_MATH.store(on, Ordering::Relaxed);
}

fn ln_of(x: f32, fast: bool) -> f32 {
    if fast { fast_ln(x) } else { x.ln() }
}

fn exp_of(x: f32, fast: bool) -> f32 {
    if fast { fast_exp(x) } else { x.exp() }
}

const FRAME_SEC: f32 = 0.046;
const OVERLAP: usize = 4;
/// リフタのカットオフを決めるためのピッチ探索範囲。
const F0_MIN: f32 = 60.0;
const F0_MAX: f32 = 1000.0;
/// リフタのカットオフ（ピッチ周期に対する比率）。
const LIFTER_RATIO: f32 = 0.6;
/// ビンごとの最大補正量（自然対数）。約 ±26 dB。
const MAX_LOG_GAIN: f32 = 3.0;

/// `x` のスペクトル包絡が E(c·f) になるようフィルタする。`c == 1` なら何もしない。
pub fn correct(x: &[f32], c: f64, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<f32> {
    if (c - 1.0).abs() < 1e-9 {
        return x.to_vec();
    }
    correct_varying(x, &|_| c, sample_rate, progress)
}

/// 変形率がフレームごとに変わる版の `correct`。`c_at` にはフレーム中心のサンプル位置を渡す。
///
/// 1フレームごとに FFT を4回（スペクトル → ケプストラム → 包絡 → 戻し）かけるが、どれも入力か出力が実数なので、
/// 2フレームを1組にして実部と虚部に詰め、1回の FFT で2フレーム分を処理する（FFT の回数が半分になる）。
pub fn correct_varying(
    x: &[f32],
    c_at: &dyn Fn(usize) -> f64,
    sample_rate: f32,
    progress: &mut dyn FnMut(f64),
) -> Vec<f32> {
    let len = x.len();
    if len == 0 {
        return Vec::new();
    }
    let n = ((sample_rate * FRAME_SEC) as usize).max(256).next_power_of_two();
    let hs = n / OVERLAP;
    let bins = n / 2 + 1;
    let fft = Fft::new(n);
    let window: Vec<f32> = hann(n);
    let lifter = Lifter {
        q_min: (sample_rate / F0_MAX) as usize,
        q_max: ((sample_rate / F0_MIN) as usize).min(n / 2 - 1),
        default_cut: (sample_rate * 0.0015) as usize,
        n,
    };
    let scale = 1.0 / n as f32;
    let fast = FAST_MATH.load(Ordering::Relaxed);

    // 端でもオーバーラップが揃うよう、フレームは信号の1フレーム手前から始める。
    let frames = (len + n) / hs + 1;
    let mut out = vec![0.0f32; len + 2 * n];
    let mut norm = vec![0.0f32; len + 2 * n];
    let (mut re, mut im) = (vec![0.0f32; n], vec![0.0f32; n]);
    let (mut cre, mut cim) = (vec![0.0f32; n], vec![0.0f32; n]);
    // 2フレーム分のスペクトル（複素、全ビン）
    let (mut ar, mut ai, mut br, mut bi) = (vec![0.0f32; n], vec![0.0f32; n], vec![0.0f32; n], vec![0.0f32; n]);
    let (mut ga, mut gb) = (vec![1.0f32; bins], vec![1.0f32; bins]);

    let mut k = 0;
    while k < frames {
        if k % 256 < 2 {
            progress(k as f64 / frames as f64);
        }
        // 1組目（A）は実部、2組目（B）は虚部に詰める。フレーム数が奇数なら最後の B は空
        let has_b = k + 1 < frames;
        let start = |k: usize| (k * hs) as i64 - n as i64;
        let sample = |s: i64| if s >= 0 && (s as usize) < len { x[s as usize] } else { 0.0 };
        let (sa, sb) = (start(k), start(k + 1));
        // 窓かけ。信号の内側に収まるフレームは、範囲の確認なしにまとめて掛ける（SIMD にしやすい）
        let fill = |dst: &mut [f32], s: i64, used: bool| {
            if !used {
                dst.fill(0.0);
            } else if s >= 0 && s as usize + n <= len {
                for ((d, &v), &w) in dst.iter_mut().zip(&x[s as usize..s as usize + n]).zip(&window) {
                    *d = v * w;
                }
            } else {
                for (i, d) in dst.iter_mut().enumerate() {
                    *d = sample(s + i as i64) * window[i];
                }
            }
        };
        fill(&mut re, sa, true);
        fill(&mut im, sb, has_b);
        let ea: f32 = re.iter().map(|v| v * v).sum();
        let eb: f32 = im.iter().map(|v| v * v).sum();
        fft.run(&mut re, &mut im, false);
        // Z = A + iB から A・B それぞれのスペクトルを取り出す: A = (Z[k] + Z*[n-k]) / 2, B = (Z[k] - Z*[n-k]) / 2i
        for b in 0..n {
            let nb = if b == 0 { 0 } else { n - b };
            let (zr, zi, cr, ci) = (re[b], im[b], re[nb], -im[nb]);
            ar[b] = 0.5 * (zr + cr);
            ai[b] = 0.5 * (zi + ci);
            br[b] = 0.5 * (zi - ci);
            bi[b] = -0.5 * (zr - cr);
        }

        let ca = c_at((sa + n as i64 / 2).clamp(0, len as i64 - 1) as usize);
        let cb = c_at((sb + n as i64 / 2).clamp(0, len as i64 - 1) as usize);
        let skip_a = ea < 1e-10 || (ca - 1.0).abs() < 1e-6;
        let skip_b = !has_b || eb < 1e-10 || (cb - 1.0).abs() < 1e-6;

        if skip_a && skip_b {
            ga.fill(1.0);
            gb.fill(1.0);
        } else {
            // 対数振幅（実数・偶関数）を実部・虚部に詰めて逆変換すると、2フレーム分の実ケプストラムが得られる。
            // 実信号の振幅は左右対称（|X[n-b]| = |X[b]|）なので、半分だけ求めて写す（ln・sqrt の回数が半分になる）
            for b in 0..bins {
                cre[b] = ln_of((ar[b] * ar[b] + ai[b] * ai[b]).sqrt() + 1e-9, fast);
                cim[b] = ln_of((br[b] * br[b] + bi[b] * bi[b]).sqrt() + 1e-9, fast);
            }
            for b in bins..n {
                cre[b] = cre[n - b];
                cim[b] = cim[n - b];
            }
            fft.run(&mut cre, &mut cim, true);
            let (cut_a, cut_b) = (lifter.cut(&cre, scale), lifter.cut(&cim, scale));
            lifter.apply(&mut cre, cut_a, scale);
            lifter.apply(&mut cim, cut_b, scale);
            // リフタ後も実数・偶関数なので、順変換の実部・虚部がそれぞれの包絡になる
            fft.run(&mut cre, &mut cim, false);
            envelope_gain(&cre[..bins], if skip_a { 1.0 } else { ca }, &mut ga, fast);
            envelope_gain(&cim[..bins], if skip_b { 1.0 } else { cb }, &mut gb, fast);
        }

        // 補正したスペクトルを Z' = A' + iB' に詰めて逆変換すると、実部・虚部が2フレーム分の波形になる
        for b in 0..n {
            let g = b.min(n - b);
            let (xr, xi) = (ar[b] * ga[g], ai[b] * ga[g]);
            let (yr, yi) = (br[b] * gb[g], bi[b] * gb[g]);
            re[b] = xr - yi;
            im[b] = xi + yr;
        }
        fft.run(&mut re, &mut im, true);
        for (s, buf, used) in [(sa, &re, true), (sb, &im, has_b)] {
            if !used {
                continue;
            }
            let o = (s + n as i64) as usize; // `out` 上の位置（n だけずらしてある）
            for (((d, w2), &v), &w) in out[o..o + n].iter_mut().zip(&mut norm[o..o + n]).zip(buf.iter()).zip(&window) {
                *d += v * scale * w;
                *w2 += w * w;
            }
        }
        k += 2;
    }

    out[n..n + len]
        .iter()
        .zip(&norm[n..n + len])
        .map(|(&v, &w)| if w > 1e-3 { v / w } else { 0.0 })
        .collect()
}

/// ケプストラムのリフタ（包絡だけを残す窓）
struct Lifter {
    q_min: usize,
    q_max: usize,
    default_cut: usize,
    n: usize,
}

impl Lifter {
    /// ピッチ周期（最も強いケプストラムのピーク）からカットオフを決める。`cep` はスケール前（n 倍）の値
    fn cut(&self, cep: &[f32], scale: f32) -> usize {
        let (mut peak_q, mut peak_v) = (0, 0.0f32);
        for q in self.q_min..=self.q_max {
            if cep[q] > peak_v {
                peak_v = cep[q];
                peak_q = q;
            }
        }
        if peak_q > 0 && peak_v * scale > 0.05 {
            ((peak_q as f32 * LIFTER_RATIO) as usize).max(4)
        } else {
            self.default_cut
        }
    }

    /// 両端から `cut` 未満は残し（`scale` 倍）、`cut` ちょうどは半分、それより内側は 0 にする
    fn apply(&self, cep: &mut [f32], cut: usize, scale: f32) {
        let n = self.n;
        let cut = cut.min(n / 2 - 1);
        cep[..cut].iter_mut().for_each(|v| *v *= scale);
        cep[n - cut + 1..].iter_mut().for_each(|v| *v *= scale);
        cep[cut + 1..n - cut].fill(0.0);
        cep[cut] *= 0.5 * scale;
        if cut > 0 {
            cep[n - cut] *= 0.5 * scale;
        }
    }
}

/// 速い近似の ln / exp は WeVocalLib に移した（ほかのソフトでも使えるように）
pub use crate::math::{fast_exp, fast_ln};

/// 包絡 `env`（対数）を E(f) から E(c·f) に変えるビンごとのゲイン。ビン間は線形補間
fn envelope_gain(env: &[f32], c: f64, gain: &mut [f32], fast: bool) {
    let bins = env.len();
    for b in 0..bins {
        let t = b as f64 * c;
        let target = if t >= (bins - 1) as f64 {
            env[bins - 1]
        } else {
            let i = t.floor() as usize;
            let g = (t - i as f64) as f32;
            env[i] + (env[i + 1] - env[i]) * g
        };
        gain[b] = exp_of((target - env[b]).clamp(-MAX_LOG_GAIN, MAX_LOG_GAIN), fast);
    }
}

/// 以前の実装（1フレームずつ FFT を4回）。高速版と結果が一致するかのテスト用に残す（Synth の dsp のテストから使うので常に公開する）
pub fn correct_varying_reference(
    x: &[f32],
    c_at: &dyn Fn(usize) -> f64,
    sample_rate: f32,
    progress: &mut dyn FnMut(f64),
) -> Vec<f32> {
    let len = x.len();
    if len == 0 {
        return Vec::new();
    }
    let n = ((sample_rate * FRAME_SEC) as usize)
        .max(256)
        .next_power_of_two();
    let hs = n / OVERLAP;
    let bins = n / 2 + 1;
    let fft = Fft::new(n);
    let window: Vec<f32> = hann(n);
    let q_min = (sample_rate / F0_MAX) as usize;
    let q_max = ((sample_rate / F0_MIN) as usize).min(n / 2 - 1);
    let default_cut = (sample_rate * 0.0015) as usize;

    // 端でもオーバーラップが揃うよう、フレームは信号の1フレーム手前から始める。
    let frames = (len + n) / hs + 1;
    let mut out = vec![0.0f32; len + 2 * n];
    let mut norm = vec![0.0f32; len + 2 * n];
    let (mut re, mut im) = (vec![0.0f32; n], vec![0.0f32; n]);
    let (mut cre, mut cim) = (vec![0.0f32; n], vec![0.0f32; n]);
    let mut env = vec![0.0f32; bins];

    for k in 0..frames {
        if k % 256 == 0 {
            progress(k as f64 / frames as f64);
        }
        let start = (k * hs) as i64 - n as i64;
        let mut energy = 0.0f32;
        for i in 0..n {
            let s = start + i as i64;
            let v = if s >= 0 && (s as usize) < len {
                x[s as usize]
            } else {
                0.0
            };
            re[i] = v * window[i];
            im[i] = 0.0;
            energy += re[i] * re[i];
        }
        let o = (start + n as i64) as usize; // `out` 上の位置（n だけずらしてある）
        let c = c_at((start + n as i64 / 2).clamp(0, len as i64 - 1) as usize);
        if energy < 1e-10 || (c - 1.0).abs() < 1e-6 {
            // 無音または補正不要: そのまま重ね合わせる（窓の総和も揃える）。
            for i in 0..n {
                out[o + i] += re[i] * window[i];
                norm[o + i] += window[i] * window[i];
            }
            continue;
        }
        fft.run(&mut re, &mut im, false);

        // 対数振幅の実ケプストラム。
        for b in 0..n {
            cre[b] = ((re[b] * re[b] + im[b] * im[b]).sqrt() + 1e-9).ln();
            cim[b] = 0.0;
        }
        fft.run(&mut cre, &mut cim, true);
        let scale = 1.0 / n as f32;

        // ピッチ周期（最も強いケプストラムのピーク）からリフタのカットオフを決める。
        let mut peak_q = 0;
        let mut peak_v = 0.0f32;
        for q in q_min..=q_max {
            if cre[q] > peak_v {
                peak_v = cre[q];
                peak_q = q;
            }
        }
        let cut = if peak_q > 0 && peak_v * scale > 0.05 {
            ((peak_q as f32 * LIFTER_RATIO) as usize).max(4)
        } else {
            default_cut
        };
        for q in 0..n {
            let d = q.min(n - q);
            let keep = if d < cut {
                1.0
            } else if d == cut {
                0.5
            } else {
                0.0
            };
            cre[q] *= keep * scale;
            cim[q] = 0.0;
        }
        fft.run(&mut cre, &mut cim, false);
        env.copy_from_slice(&cre[..bins]);

        // E(f) を E(c·f) に変えるゲイン。ビン間は線形補間。
        for b in 0..bins {
            let t = b as f64 * c;
            let target = if t >= (bins - 1) as f64 {
                env[bins - 1]
            } else {
                let i = t.floor() as usize;
                let g = (t - i as f64) as f32;
                env[i] + (env[i + 1] - env[i]) * g
            };
            let gain = (target - env[b]).clamp(-MAX_LOG_GAIN, MAX_LOG_GAIN).exp();
            re[b] *= gain;
            im[b] *= gain;
            if b > 0 && b < n / 2 {
                re[n - b] *= gain;
                im[n - b] *= gain;
            }
        }
        fft.run(&mut re, &mut im, true);
        for i in 0..n {
            out[o + i] += re[i] * scale * window[i];
            norm[o + i] += window[i] * window[i];
        }
    }

    out[n..n + len]
        .iter()
        .zip(&norm[n..n + len])
        .map(|(&v, &w)| if w > 1e-3 { v / w } else { 0.0 })
        .collect()
}

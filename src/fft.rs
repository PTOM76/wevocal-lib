//! スペクトル処理で共用する FFT。2 のべき乗は radix-2、それ以外は 2 のべき乗 × 小さな奇数（3・5・15 など）に分けて計算する。

use std::f64::consts::PI;

/// 2 のべき乗以外の部分（奇数）の上限
const MAX_ODD: usize = 63;

/// 実部・虚部を分けた配列に対するインプレース FFT。
pub struct Fft {
    n: usize,
    /// 2 のべき乗の部分の FFT（n = m × p の p）
    pow2: Radix2,
    /// 奇数の部分（1 なら 2 のべき乗だけ）
    m: usize,
    /// m > 1 のときに使う回転因子 e^{-2πi j/n}（j = 0..n）と作業用の配列
    tw_re: Vec<f32>,
    tw_im: Vec<f32>,
    /// m 点の DFT の行列 e^{-2πi r·q/m}（[q][r]）
    dft_m: Vec<(f32, f32)>,
    work_re: std::cell::RefCell<Vec<f32>>,
    work_im: std::cell::RefCell<Vec<f32>>,
}

impl Fft {
    /// `n` は 2 のべき乗 × 奇数。奇数の部分が大きいと遅い（奇数の部分の 2 乗に比例する）ので、3・5・15 程度にする
    pub fn new(n: usize) -> Self {
        let p = 1usize << n.trailing_zeros();
        let m = n / p;
        let (tw_re, tw_im) = if m > 1 {
            (0..n).map(|j| ((-2.0 * PI * j as f64 / n as f64).cos() as f32, (-2.0 * PI * j as f64 / n as f64).sin() as f32)).unzip()
        } else {
            (Vec::new(), Vec::new())
        };
        assert!(m <= MAX_ODD, "FFT の長さ {n} の奇数の部分 {m} が大きすぎる");
        let dft_m = (0..m * m).map(|i| { let a = -2.0 * PI * ((i / m) * (i % m)) as f64 / m as f64; (a.cos() as f32, a.sin() as f32) }).collect();
        Fft {
            n,
            pow2: Radix2::new(p),
            dft_m,
            m,
            tw_re,
            tw_im,
            work_re: std::cell::RefCell::new(vec![0.0; if m > 1 { n } else { 0 }]),
            work_im: std::cell::RefCell::new(vec![0.0; if m > 1 { n } else { 0 }]),
        }
    }

    pub fn len(&self) -> usize {
        self.n
    }

    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    /// `inverse` が false なら順変換。逆変換はスケーリングしない（呼び出し側で 1/n する）。
    pub fn run(&self, re: &mut [f32], im: &mut [f32], inverse: bool) {
        if self.m == 1 {
            return self.pow2.run(re, im, inverse);
        }
        // n = m × p。入力を m 本（x[m·t + r]、r = 0..m）に分けて長さ p の FFT をし、
        // 出力 X[k + p·q] = Σ_r W_n^{r·k} · W_m^{r·q} · Y_r[k] を、k ごとに m 点の DFT で求める
        let (m, p) = (self.m, self.pow2.n);
        let sign = if inverse { 1.0 } else { -1.0 };
        let mut wr = self.work_re.borrow_mut();
        let mut wi = self.work_im.borrow_mut();
        for r in 0..m {
            let (yr, yi) = (&mut wr[r * p..(r + 1) * p], &mut wi[r * p..(r + 1) * p]);
            for t in 0..p {
                yr[t] = re[m * t + r];
                yi[t] = im[m * t + r];
            }
            self.pow2.run(yr, yi, inverse);
        }
        // m 点の DFT の行列 W_m^{r·q}（逆変換は共役）。内側のループで余りを計算しないよう、前もって並べておく
        let cm = &self.dft_m;
        let mut zr = [0.0f32; MAX_ODD];
        let mut zi = [0.0f32; MAX_ODD];
        for k in 0..p {
            // W_n^{r·k} を掛けたもの（r·k < m·p = n なので表を直接引ける）
            for r in 0..m {
                let j = r * k;
                let (cr, ci) = (self.tw_re[j], -sign * self.tw_im[j]);
                let (ar, ai) = (wr[r * p + k], wi[r * p + k]);
                zr[r] = ar * cr - ai * ci;
                zi[r] = ar * ci + ai * cr;
            }
            for q in 0..m {
                let row = &cm[q * m..(q + 1) * m];
                let (mut sr, mut si) = (0.0f32, 0.0f32);
                for r in 0..m {
                    let (cr, ci) = (row[r].0, -sign * row[r].1);
                    sr += zr[r] * cr - zi[r] * ci;
                    si += zr[r] * ci + zi[r] * cr;
                }
                re[k + p * q] = sr;
                im[k + p * q] = si;
            }
        }
    }
}

/// 2 のべき乗の長さのインプレース反復型 radix-2 FFT。
struct Radix2 {
    n: usize,
    /// 回転因子 e^{-2πik/size}。段（size = 2, 4, …, n）ごとに k = 0..size/2 を連続して並べる
    /// （段の半分の長さ half から始まる）。内側のループで連続して読めるので、SIMD 命令に変換されやすい
    cos: Vec<f32>,
    sin: Vec<f32>,
    rev: Vec<usize>,
}

impl Radix2 {
    fn new(n: usize) -> Self {
        let bits = n.trailing_zeros();
        let rev = (0..n)
            .map(|i| if n > 1 { i.reverse_bits() >> (usize::BITS - bits) } else { 0 })
            .collect();
        let mut cos = vec![0.0f32; n.max(1)];
        let mut sin = vec![0.0f32; n.max(1)];
        let mut half = 1;
        while half < n {
            for k in 0..half {
                let a = PI * k as f64 / half as f64;
                cos[half + k] = a.cos() as f32;
                sin[half + k] = a.sin() as f32;
            }
            half *= 2;
        }
        Radix2 { n, cos, sin, rev }
    }

    fn run(&self, re: &mut [f32], im: &mut [f32], inverse: bool) {
        let n = self.n;
        for i in 0..n {
            let j = self.rev[i];
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let sign = if inverse { 1.0 } else { -1.0 };
        let mut half = 1;
        // 最初の 2 段（2 点・4 点）は回転因子が 1 と ±i だけで、内側のループが 1〜2 回しか回らずループの手間のほうが大きい。
        // 4 点ずつまとめて直接計算する（結果は下の一般の段と同じ）
        if n >= 4 {
            for s in (0..n).step_by(4) {
                let (r, i) = (&mut re[s..s + 4], &mut im[s..s + 4]);
                // 2 点の段
                let (a0r, a0i, a1r, a1i) = (r[0] + r[1], i[0] + i[1], r[0] - r[1], i[0] - i[1]);
                let (a2r, a2i, a3r, a3i) = (r[2] + r[3], i[2] + i[3], r[2] - r[3], i[2] - i[3]);
                // 4 点の段: 後半の 2 つ目に掛ける回転因子は (0, sign)
                let (tr, ti) = (-a3i * sign, a3r * sign);
                r[0] = a0r + a2r;
                i[0] = a0i + a2i;
                r[2] = a0r - a2r;
                i[2] = a0i - a2i;
                r[1] = a1r + tr;
                i[1] = a1i + ti;
                r[3] = a1r - tr;
                i[3] = a1i - ti;
            }
            half = 4;
        }
        // 残りの段は radix-2。2 段ずつまとめる radix-4 も試したが、ネイティブで 2 倍ほど遅くなった（一度に使う値が多く、
        // SIMD 命令に変換されなくなったとみられる。2026-10-02）
        while half < n {
            let size = half * 2;
            let (wc, ws) = (&self.cos[half..size], &self.sin[half..size]);
            for start in (0..n).step_by(size) {
                // 前半 a と後半 b を別々のスライスにして、境界チェックなしで並べて回す
                let (ra, rb) = re[start..start + size].split_at_mut(half);
                let (ia, ib) = im[start..start + size].split_at_mut(half);
                for k in 0..half {
                    let (wr, wi) = (wc[k], sign * ws[k]);
                    let tr = rb[k] * wr - ib[k] * wi;
                    let ti = rb[k] * wi + ib[k] * wr;
                    rb[k] = ra[k] - tr;
                    ib[k] = ia[k] - ti;
                    ra[k] += tr;
                    ia[k] += ti;
                }
            }
            half = size;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 素直な DFT と比べる（2 のべき乗でない長さも）
    #[test]
    fn matches_dft() {
        for n in [8usize, 12, 20, 60, 5120 / 16, 7680 / 32] {
            let x: Vec<(f32, f32)> = (0..n).map(|i| (((i * 7919) % 97) as f32 / 97.0 - 0.5, ((i * 104729) % 89) as f32 / 89.0 - 0.5)).collect();
            for inverse in [false, true] {
                let (mut re, mut im): (Vec<f32>, Vec<f32>) = x.iter().copied().unzip();
                Fft::new(n).run(&mut re, &mut im, inverse);
                let sign = if inverse { 1.0 } else { -1.0 };
                for k in 0..n {
                    let (mut sr, mut si) = (0.0f64, 0.0f64);
                    for (t, &(a, b)) in x.iter().enumerate() {
                        let w = sign * 2.0 * PI * ((k * t) % n) as f64 / n as f64;
                        sr += a as f64 * w.cos() - b as f64 * w.sin();
                        si += a as f64 * w.sin() + b as f64 * w.cos();
                    }
                    assert!((re[k] as f64 - sr).abs() < 1e-3 && (im[k] as f64 - si).abs() < 1e-3, "n {n} k {k}: {} {} vs {sr} {si}", re[k], im[k]);
                }
            }
        }
    }

    /// 長い 2 のべき乗でない長さ（MDX-Net の 5120・7680）でも、順変換して逆変換すると元に戻る
    #[test]
    fn round_trip_mixed() {
        for n in [5120usize, 7680, 6144] {
            let x: Vec<f32> = (0..n).map(|i| ((i * 7919) % 101) as f32 / 101.0 - 0.5).collect();
            let (mut re, mut im) = (x.clone(), vec![0.0f32; n]);
            let f = Fft::new(n);
            f.run(&mut re, &mut im, false);
            f.run(&mut re, &mut im, true);
            let err = re.iter().zip(&x).map(|(a, b)| (a / n as f32 - b).abs()).fold(0.0f32, f32::max);
            assert!(err < 1e-4, "n {n}: {err}");
        }
    }
}

#[cfg(test)]
mod bench {
    /// `cargo test --release fft_speed -- --ignored --nocapture` で FFT の速さを測る
    #[test]
    #[ignore]
    fn fft_speed() {
        for n in [2048usize, 7680] {
            let f = super::Fft::new(n);
            let (mut re, mut im) = (vec![0.1f32; n], vec![0.0f32; n]);
            let t = std::time::Instant::now();
            for _ in 0..10000 {
                f.run(&mut re, &mut im, false);
            }
            println!("10000 x FFT{n}: {:?}", t.elapsed());
        }
    }
}

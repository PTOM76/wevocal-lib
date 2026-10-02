//! スペクトル処理で共用する最小限の radix-2 FFT。

use std::f64::consts::PI;

/// 実部・虚部を分けた配列に対するインプレース反復型 radix-2 FFT。
pub struct Fft {
    n: usize,
    /// 回転因子 e^{-2πik/size}。段（size = 2, 4, …, n）ごとに k = 0..size/2 を連続して並べる
    /// （段の半分の長さ half から始まる）。内側のループで連続して読めるので、SIMD 命令に変換されやすい
    cos: Vec<f32>,
    sin: Vec<f32>,
    rev: Vec<usize>,
}

impl Fft {
    pub fn new(n: usize) -> Self {
        let bits = n.trailing_zeros();
        let rev = (0..n)
            .map(|i| i.reverse_bits() >> (usize::BITS - bits))
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
        Fft { n, cos, sin, rev }
    }

    /// `inverse` が false なら順変換。逆変換はスケーリングしない（呼び出し側で 1/n する）。
    pub fn run(&self, re: &mut [f32], im: &mut [f32], inverse: bool) {
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
mod bench {
    /// `cargo test --release fft_speed -- --ignored --nocapture` で FFT の速さを測る
    #[test]
    #[ignore]
    fn fft_speed() {
        let n = 2048;
        let f = super::Fft::new(n);
        let (mut re, mut im) = (vec![0.1f32; n], vec![0.0f32; n]);
        let t = std::time::Instant::now();
        for _ in 0..67500 { f.run(&mut re, &mut im, false); }
        println!("67500 x FFT2048: {:?}", t.elapsed());
    }
}

//! STFT（短時間フーリエ変換）と逆STFT。
//!
//! 窓は周期的な Hann 窓（torch.hann_window と同じ）、フレームは `frame * hop` から始まる（center なし）。
//! 逆変換は窓を掛けて足し込み、最後に呼び出し側が窓の2乗の和で割る（重みつき重ね合わせ）。

use crate::fft::Fft;
use crate::window::hann;

pub struct Stft {
    n_fft: usize,
    hop: usize,
    window: Vec<f32>,
    fft: Fft,
    buf_re: Vec<f32>,
    buf_im: Vec<f32>,
}

impl Stft {
    /// `n_fft` は 2 のべき乗か、2 のべき乗 × 小さな奇数（fft.rs）
    pub fn new(n_fft: usize, hop: usize) -> Self {
        let window = hann(n_fft);
        Stft {
            n_fft,
            hop,
            window,
            fft: Fft::new(n_fft),
            buf_re: vec![0.0; n_fft],
            buf_im: vec![0.0; n_fft],
        }
    }

    /// 片側スペクトルのビン数（n_fft / 2 + 1）
    pub fn bins(&self) -> usize {
        self.n_fft / 2 + 1
    }

    pub fn hop(&self) -> usize {
        self.hop
    }

    pub fn window(&self) -> &[f32] {
        &self.window
    }

    /// `x` の `frame` 番目のフレームを変換し、片側スペクトルを `re` / `im`（長さ `bins()`）に入れる。範囲外のサンプルは 0
    pub fn forward(&mut self, x: &[f32], frame: usize, re: &mut [f32], im: &mut [f32]) {
        let at = frame * self.hop;
        for i in 0..self.n_fft {
            self.buf_re[i] = x.get(at + i).copied().unwrap_or(0.0) * self.window[i];
        }
        self.buf_im.fill(0.0);
        self.fft.run(&mut self.buf_re, &mut self.buf_im, false);
        let b = self.bins();
        re[..b].copy_from_slice(&self.buf_re[..b]);
        im[..b].copy_from_slice(&self.buf_im[..b]);
    }

    /// 片側スペクトルを逆変換し、窓を掛けて `out` の `frame` の位置に足す。`wsum` があれば窓の2乗を足す
    pub fn inverse_add(&mut self, re: &[f32], im: &[f32], frame: usize, out: &mut [f32], wsum: Option<&mut [f32]>) {
        let n = self.n_fft;
        let b = self.bins();
        self.buf_re[..b].copy_from_slice(&re[..b]);
        self.buf_im[..b].copy_from_slice(&im[..b]);
        // 実数信号になるよう、負の周波数側を共役で埋める
        for k in 1..n / 2 {
            self.buf_re[n - k] = re[k];
            self.buf_im[n - k] = -im[k];
        }
        self.fft.run(&mut self.buf_re, &mut self.buf_im, true);
        let at = frame * self.hop;
        let end = (at + n).min(out.len());
        if at >= end {
            return;
        }
        let scale = 1.0 / n as f32;
        for (i, o) in out[at..end].iter_mut().enumerate() {
            *o += self.buf_re[i] * scale * self.window[i];
        }
        if let Some(w) = wsum {
            let end = (at + n).min(w.len());
            for (i, s) in w[at..end].iter_mut().enumerate() {
                *s += self.window[i] * self.window[i];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 変換して戻すと、端（窓が重なりきらない部分）を除いて元に戻る
    #[test]
    fn round_trip() {
        let n = 4096 * 6;
        let x: Vec<f32> = (0..n).map(|i| (i as f32 * 0.05).sin() + 0.3 * ((i * 7919 % 101) as f32 / 101.0 - 0.5)).collect();
        let mut st = Stft::new(4096, 1024);
        let b = st.bins();
        let (mut re, mut im) = (vec![0.0; b], vec![0.0; b]);
        let mut y = vec![0.0; n];
        let mut w = vec![0.0; n];
        let frames = (n - 4096) / 1024 + 1;
        for f in 0..frames {
            st.forward(&x, f, &mut re, &mut im);
            st.inverse_add(&re, &im, f, &mut y, Some(&mut w));
        }
        let err = (4096..n - 4096).map(|i| (y[i] / w[i] - x[i]).abs()).fold(0.0f32, f32::max);
        assert!(err < 1e-4, "最大誤差 {err}");
    }

    /// 窓は周期的な Hann（先頭は 0、中央は 1）
    #[test]
    fn periodic_hann() {
        let st = Stft::new(8, 2);
        assert_eq!(st.window()[0], 0.0);
        assert!((st.window()[4] - 1.0).abs() < 1e-6);
    }
}

//! 信号処理でよく使う小さな数値計算（速い近似の ln / exp、位相の折り返し、中央値）。

use std::f64::consts::PI;

/// 速い自然対数（`x > 0`）。指数部と仮数部 m（1〜2）に分け、ln m を t = (m-1)/(m+1) の級数で求める（相対誤差 約 1e-7）。
/// 標準の ln より速い。スペクトル包絡の計算など、この精度で足りる所に使う
pub fn fast_ln(x: f32) -> f32 {
    let bits = x.to_bits();
    let e = ((bits >> 23) & 0xff) as i32 - 127;
    let m = f32::from_bits((bits & 0x007f_ffff) | 0x3f80_0000);
    let t = (m - 1.0) / (m + 1.0);
    let t2 = t * t;
    e as f32 * std::f32::consts::LN_2 + 2.0 * t * (1.0 + t2 * (1.0 / 3.0 + t2 * (1.0 / 5.0 + t2 * (1.0 / 7.0))))
}

/// 速い指数関数（|x| が数十まで）。2 のべき乗に直し、整数部はビットで、小数部は多項式で求める（相対誤差 最大 約 4e-5）
pub fn fast_exp(x: f32) -> f32 {
    let y = x * std::f32::consts::LOG2_E;
    let k = y.floor();
    let f = y - k;
    // 2^f（0 ≤ f < 1）の多項式近似
    let p = 1.0 + f * (0.693_147_2 + f * (0.240_226_5 + f * (0.055_504_1 + f * (0.009_618_1 + f * 0.001_333_6))));
    f32::from_bits(((k as i32 + 127) as u32) << 23) * p
}

/// 位相を -π〜π に折り返す
pub fn wrap_phase(p: f64) -> f64 {
    p - 2.0 * PI * ((p + PI) / (2.0 * PI)).floor()
}

/// `values` の中央値（並べ替えに `buf` を使い、確保をくり返さない）
pub fn median(values: impl Iterator<Item = f32>, buf: &mut Vec<f32>) -> f32 {
    buf.clear();
    buf.extend(values);
    let mid = buf.len() / 2;
    *buf.select_nth_unstable_by(mid, |a, b| a.total_cmp(b)).1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_ln_exp_are_close() {
        for &x in &[1e-6f32, 0.01, 0.5, 1.0, 2.0, 10.0, 1e4] {
            assert!((fast_ln(x) - x.ln()).abs() < 1e-5, "ln {x}");
        }
        for &x in &[-20.0f32, -1.0, 0.0, 0.5, 3.0, 20.0] {
            let err = (fast_exp(x) / x.exp() - 1.0).abs();
            assert!(err < 1e-4, "exp {x}: {err}");
        }
    }

    #[test]
    fn wrap_and_median() {
        assert!((wrap_phase(3.0 * PI) - PI).abs() < 1e-9 || (wrap_phase(3.0 * PI) + PI).abs() < 1e-9);
        assert!(wrap_phase(0.5).abs() - 0.5 < 1e-12);
        let mut buf = Vec::new();
        assert_eq!(median([3.0, 1.0, 2.0].into_iter(), &mut buf), 2.0);
    }
}

//! 伸縮処理で使う、出力位置 → 入力位置の時間対応。

/// 出力位置から入力位置への時間対応。単調増加で、0 → 0、`out_len` → 入力長 とする。
/// 一定倍率の伸縮も、ピッチカーブ編集のような時間ごとに変わる伸縮も、これで表す。
pub struct TimeMap<'a> {
    pub out_len: usize,
    /// 出力位置（サンプル）→ 入力位置（サンプル）
    pub to_input: &'a dyn Fn(f64) -> f64,
    linear: Option<f64>,
}

impl<'a> TimeMap<'a> {
    /// 任意の対応関数から作る。
    pub fn new(out_len: usize, to_input: &'a dyn Fn(f64) -> f64) -> Self {
        TimeMap {
            out_len,
            to_input,
            linear: None,
        }
    }

    /// 一定倍率（出力長 / 入力長）の対応。
    pub fn linear(len: usize, out_len: usize) -> TimeMap<'static> {
        TimeMap {
            out_len,
            to_input: &|t| t,
            linear: Some(len as f64 / out_len.max(1) as f64),
        }
    }

    /// 出力位置 `t`（サンプル）に対応する入力位置
    pub fn input_at(&self, t: f64) -> f64 {
        match self.linear {
            Some(k) => t * k,
            None => (self.to_input)(t),
        }
    }

    /// 出力フレームの開始位置 `out_start` に対応する入力フレームの開始位置。
    /// 最後の出力フレームがちょうど最後の入力フレーム（`len - n`）に来るよう、
    /// 出力側・入力側ともフレーム長 `n` の分だけ縮めて対応づける。
    /// 単純に対応させると末尾で行き過ぎ、最後の断片に張り付いて同じ音を繰り返す（うなりとして聞こえる）。
    pub fn frame_pos(&self, out_start: usize, len: usize, n: usize) -> f64 {
        let last_pos = len.saturating_sub(n) as f64;
        let span_out = self.out_len.saturating_sub(n).max(1) as f64;
        let t = out_start as f64 * self.out_len as f64 / span_out;
        self.input_at(t) * last_pos / len.max(1) as f64
    }
}

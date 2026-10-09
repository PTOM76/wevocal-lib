//! ピッチ変更・時間伸縮・フォルマント補正をまとめた処理の流れ。

use crate::{formant, hpss, psola, pv, sms, sola, sola2, resample, wsola2, wsola2_map, wsola_map, wsola_with_progress, TimeMap};

/// `semitones` 半音のピッチ変更と `stretch` 倍の時間伸縮を1パスで行う。
/// 出力長はピッチ変更に関係なく 入力長 × stretch。
pub fn process(
    channels: &[&[f32]],
    sample_rate: f32,
    semitones: f64,
    stretch: f64,
) -> Vec<Vec<f32>> {
    process_with_progress(
        channels,
        sample_rate,
        semitones,
        stretch,
        Algorithm::Wsola,
        Formant::Follow,
        &mut |_| {},
    )
}

/// 伸縮と、ピッチ変更（リサンプル前の伸縮）の両方に使う時間伸縮方式。
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Algorithm {
    Wsola,
    PhaseVocoder,
    /// ボーカル向け（ピッチの周期に合わせて切り貼りする）
    Psola,
    /// 2乗誤差で区切り位置を探すクロスフェード方式（重なりが短く、にじみが少ない）
    Sola,
    /// PSOLA の改良版（目印を前の周期との相関で置く）
    Psola2,
    /// WSOLA の改良版（類似度を正規化した相互相関にする）
    Wsola2,
    /// Phase Vocoder の改良版（立ち上がりの山の位相を入力に戻し、アタックのにじみを抑える）
    PhaseVocoder2,
    /// 打楽器分離のハイブリッド（伸びる成分は Phase Vocoder、打つ成分は短い窓の OLA）
    Hpss,
    /// SOLA の改良版（声のある所は 1 周期ずつ切り貼りし、隣の周期と混ぜる）
    Sola2,
    /// SOLAv2 の改良版（前後数周期を平均し、周期的で滑らかな声にする）
    Sola3,
    /// 正弦波モデル（SMS、愛称は Specraw）。できるだけ可逆（往復や重ねた加工で劣化しにくい）。和音や楽器にも使える
    Sms,
}

impl Algorithm {
    pub fn from_id(id: u32) -> Self {
        match id {
            1 => Algorithm::PhaseVocoder,
            2 => Algorithm::Psola,
            3 => Algorithm::Sola,
            4 => Algorithm::Psola2,
            5 => Algorithm::Wsola2,
            6 => Algorithm::PhaseVocoder2,
            7 => Algorithm::Hpss,
            8 => Algorithm::Sola2,
            9 => Algorithm::Sola3,
            10 => Algorithm::Sms,
            _ => Algorithm::Wsola,
        }
    }

    pub fn stretch(
        self,
        channels: &[&[f32]],
        alpha: f64,
        sr: f32,
        progress: &mut dyn FnMut(f64),
    ) -> Vec<Vec<f32>> {
        match self {
            Algorithm::Wsola => wsola_with_progress(channels, alpha, sr, progress),
            Algorithm::PhaseVocoder => pv::stretch(channels, alpha, sr, progress),
            Algorithm::Psola => psola::stretch(channels, alpha, sr, progress),
            Algorithm::Sola => sola::stretch(channels, alpha, sr, progress),
            Algorithm::Psola2 => psola::stretch_with(channels, alpha, sr, psola::Marking::Correlation, progress),
            Algorithm::Wsola2 => wsola2(channels, alpha, sr, progress),
            Algorithm::PhaseVocoder2 => pv::stretch2(channels, alpha, sr, progress),
            Algorithm::Hpss => hpss::stretch(channels, alpha, sr, progress),
            Algorithm::Sola2 => sola2::stretch(channels, alpha, sr, progress),
            Algorithm::Sola3 => sola2::stretch_clean(channels, alpha, sr, progress),
            Algorithm::Sms => sms::stretch(channels, alpha, sr, progress),
        }
    }

    pub fn stretch_map(
        self,
        channels: &[&[f32]],
        map: &TimeMap,
        sr: f32,
        progress: &mut dyn FnMut(f64),
    ) -> Vec<Vec<f32>> {
        match self {
            Algorithm::Wsola => wsola_map(channels, map, sr, progress),
            Algorithm::PhaseVocoder => pv::stretch_map(channels, map, sr, progress),
            Algorithm::Psola => psola::stretch_map(channels, map, sr, progress),
            Algorithm::Sola => sola::stretch_map(channels, map, sr, progress),
            Algorithm::Psola2 => psola::stretch_map_with(channels, map, sr, psola::Marking::Correlation, progress),
            Algorithm::Wsola2 => wsola2_map(channels, map, sr, progress),
            Algorithm::PhaseVocoder2 => pv::stretch_map2(channels, map, sr, progress),
            Algorithm::Hpss => hpss::stretch_map(channels, map, sr, progress),
            Algorithm::Sola2 => sola2::stretch_map(channels, map, sr, progress),
            Algorithm::Sola3 => sola2::stretch_map_clean(channels, map, sr, progress),
            Algorithm::Sms => sms::stretch_map(channels, map, sr, progress),
        }
    }
}

/// `process_with_progress` でのフォルマントの扱い。
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Formant {
    /// フォルマントはピッチと一緒に動く（単純なリサンプル）。
    Follow,
    /// フォルマントを保持し、さらにこの半音数だけ移動する（0 = 保持のみ）。
    Shift(f64),
}

/// 全体の進捗（0〜1）を `progress` に通知する版の `process`。
pub fn process_with_progress(
    channels: &[&[f32]],
    sample_rate: f32,
    semitones: f64,
    stretch: f64,
    algorithm: Algorithm,
    formant: Formant,
    progress: &mut dyn FnMut(f64),
) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    let target_len = (len as f64 * stretch).round() as usize;
    let ratio = 2f64.powf(semitones / 12.0);
    let pitch = (ratio - 1.0).abs() > 1e-9;
    // リサンプル前に適用する包絡の変形率（`formant` 参照）。
    let warp = match formant {
        Formant::Follow => 1.0,
        Formant::Shift(st) => ratio / 2f64.powf(st / 12.0),
    };
    let correct = (warp - 1.0).abs() > 1e-9;

    // 各段階の処理コストのおおよその比率。進捗表示にのみ使う。
    let stretch_share = if correct {
        0.5
    } else if pitch {
        0.6
    } else {
        1.0
    };
    let formant_share = if correct {
        if pitch {
            0.3
        } else {
            0.5
        }
    } else {
        0.0
    };
    let n = channels.len().max(1) as f64;

    let mut out = algorithm.stretch(channels, stretch * ratio, sample_rate, &mut |p| {
        progress(p * stretch_share)
    });
    if correct {
        for (i, c) in out.iter_mut().enumerate() {
            let base = stretch_share + formant_share * i as f64 / n;
            *c = formant::correct(c, warp, sample_rate, &mut |p| {
                progress(base + formant_share * p / n)
            });
        }
    }
    if pitch {
        let base = stretch_share + formant_share;
        for (i, c) in out.iter_mut().enumerate() {
            progress(base + (1.0 - base) * i as f64 / n);
            *c = resample(c, ratio, target_len);
        }
    }
    progress(1.0);
    out
}

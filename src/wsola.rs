//! WSOLA（Waveform Similarity Overlap-Add）による時間伸縮。

use crate::TimeMap;
use crate::window::hann;

/// 分析フレーム長（秒）。約46ms: 低い声でも十分な長さ。
const FRAME_SEC: f32 = 0.046;
/// 探索許容幅（秒）。約12ms: 約83Hz までのピッチ周期1つ分をカバーする。
const TOLERANCE_SEC: f32 = 0.012;

/// 全チャンネルを `alpha` 倍に時間伸縮する（出力長 = 入力長 × alpha）。
/// 全チャンネルで同じフレーム位置を使い、ステレオ定位を崩さない。
pub fn wsola(channels: &[&[f32]], alpha: f64, sample_rate: f32) -> Vec<Vec<f32>> {
    wsola_with_progress(channels, alpha, sample_rate, &mut |_| {})
}

/// 進捗（0〜1）を `progress` に通知する版の `wsola`。
pub fn wsola_with_progress(
    channels: &[&[f32]],
    alpha: f64,
    sample_rate: f32,
    progress: &mut dyn FnMut(f64),
) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    if (alpha - 1.0).abs() < 1e-9 {
        return channels.iter().map(|c| c.to_vec()).collect();
    }
    let out_len = (len as f64 * alpha).round() as usize;
    wsola_map(
        channels,
        &TimeMap::linear(len, out_len),
        sample_rate,
        progress,
    )
}

/// 任意の時間対応 `map` で全チャンネルを WSOLA 伸縮する。
pub fn wsola_map(
    channels: &[&[f32]],
    map: &TimeMap,
    sample_rate: f32,
    progress: &mut dyn FnMut(f64),
) -> Vec<Vec<f32>> {
    wsola_map_with(channels, map, sample_rate, progress, false)
}

/// 改良版（WSOLA 2）。類似度を候補のエネルギーで正規化した相互相関にする。
/// 正規化しない内積は「似ている位置」より「音の大きい位置」を選びやすく、位置合わせがずれてにじみ・うなりになる。
/// Verhelst & Roelands (1993) の WSOLA も、候補の選び方には正規化した相互相関などの類似度を使う
pub fn wsola2_map(
    channels: &[&[f32]],
    map: &TimeMap,
    sample_rate: f32,
    progress: &mut dyn FnMut(f64),
) -> Vec<Vec<f32>> {
    wsola_map_with(channels, map, sample_rate, progress, true)
}

/// `wsola2_map` の一定倍率版
pub fn wsola2(channels: &[&[f32]], alpha: f64, sample_rate: f32, progress: &mut dyn FnMut(f64)) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    if (alpha - 1.0).abs() < 1e-9 {
        return channels.iter().map(|c| c.to_vec()).collect();
    }
    let out_len = (len as f64 * alpha).round() as usize;
    wsola2_map(channels, &TimeMap::linear(len, out_len), sample_rate, progress)
}

/// WSOLA の本体。`normalized` なら類似度を候補のエネルギーで正規化する
fn wsola_map_with(
    channels: &[&[f32]],
    map: &TimeMap,
    sample_rate: f32,
    progress: &mut dyn FnMut(f64),
    normalized: bool,
) -> Vec<Vec<f32>> {
    let len = channels.first().map_or(0, |c| c.len());
    let out_len = map.out_len;
    if len == 0 || out_len == 0 {
        return vec![Vec::new(); channels.len()];
    }

    let mut n = ((sample_rate * FRAME_SEC) as usize).max(64);
    n += n % 2;
    let hs = n / 2;
    let delta = ((sample_rate * TOLERANCE_SEC) as i64).max(8);
    // periodic Hann 窓: 50% オーバーラップで総和がちょうど 1 になる。
    let window: Vec<f32> = hann(n);

    // ゼロ詰めしたモノラルミックス。相関計算で境界チェックなしにスライスを使えるようにする。
    let pad_l = delta as usize + 8;
    let pad_r = n + hs + delta as usize + 8;
    let mut mono = vec![0.0f32; pad_l + len + pad_r];
    for c in channels {
        for (m, &v) in mono[pad_l..pad_l + len].iter_mut().zip(c.iter()) {
            *m += v / channels.len() as f32;
        }
    }
    let max_pos = (len + hs + delta as usize) as i64;
    let seg = |p: i64| -> &[f32] {
        let s = (p.clamp(-(delta + 4), max_pos) + pad_l as i64) as usize;
        &mono[s..s + n]
    };
    // 類似度は重なり部分（各フレームの前半）だけで計算する。
    // `a` は前フレームの自然な続きで探索中は変わらないので、正規化は候補 `b` のエネルギーだけで足りる
    let corr = |a: i64, b: i64, step: usize| -> f32 {
        let (mut dot, mut eb) = (0.0f32, 0.0f32);
        for (x, y) in seg(a)[..hs].iter().step_by(step).zip(seg(b)[..hs].iter().step_by(step)) {
            dot += x * y;
            eb += y * y;
        }
        if normalized { dot / (eb.sqrt() + 1e-9) } else { dot }
    };

    let mut out = vec![vec![0.0f32; out_len + n]; channels.len()];
    let mut wsum = vec![0.0f32; out_len + n];
    let frames = out_len / hs + 1;
    let mut prev_pos: i64 = 0;
    // フレームは入力の内側に収める。末尾で最後のサンプルをはみ出すと
    // 無音を重ね合わせてしまい、末尾がギザギザになる。
    let last_pos = len.saturating_sub(n) as i64;
    let clamp_pos = |p: i64| p.clamp(0, last_pos);
    // WSOLA 2 は、立ち上がり（破裂音など）を 1 回だけ等速で読む（SOLAv2 と同じ。フレームが長く重なるので、伸ばすと何度も切り出されて二重になる）
    let onsets = if normalized { crate::sola2::onsets(&mono[pad_l..pad_l + len], sample_rate) } else { Vec::new() };
    let transient = (sample_rate as f64 * crate::sola2::PARAMS.transient) as i64;
    // 次に鳴らす立ち上がりの番号、等速で読み終える入力の位置（ここまでは前のフレームの続きを読み、読み終えたらここより前に戻らない）
    let (mut next, mut lock) = (0usize, -1i64);

    for k in 0..frames {
        if k % 256 == 0 {
            progress(k as f64 / frames as f64);
        }
        let out_start = k * hs;
        let nominal = map.frame_pos(out_start, len, n).round() as i64;
        // 立ち上がりの扱い。決めた位置があれば、似ている位置の探索はしない
        let mut forced = None;
        if k > 0 && !onsets.is_empty() {
            let natural = prev_pos + hs as i64;
            if natural < lock {
                forced = Some(natural);
            } else {
                // 予定の時刻を通り過ぎたもの（前のフレームで読んだものなど）は数えない
                while next < onsets.len() && onsets[next] < nominal.max(lock) - hs as i64 {
                    next += 1;
                }
                if let Some(&o) = onsets.get(next) {
                    // 立ち上がりが鳴るべき出力の位置（フレームの頭から）。フレームに収まるなら、そこに来るよう読み始める
                    let rate = ((map.frame_pos(out_start + hs, len, n).round() as i64 - nominal).max(1)) as f64 / hs as f64;
                    let at = ((o - nominal) as f64 / rate).round() as i64;
                    if at < (n - hs / 2) as i64 {
                        forced = Some(clamp_pos(o - at.max(0)));
                        lock = o + transient;
                        next += 1;
                    }
                }
            }
        }
        let pos = if k == 0 {
            0
        } else if let Some(p) = forced {
            p
        } else {
            // 出力フレームに対応する入力位置は `nominal`（末尾の扱いは `TimeMap::frame_pos` 参照）。
            // 前フレームの自然な続き（新しいフレームと重なる部分）。
            // prev_pos <= last_pos なので入力の内側に収まる。
            let natural = prev_pos + hs as i64;
            // 粗く探索してから、最良候補の周辺を精密に探索する。
            let (mut best, mut best_c) = (nominal, f32::MIN);
            let mut off = -delta;
            while off <= delta {
                let cand = clamp_pos(nominal + off);
                let c = corr(natural, cand, 8);
                if c > best_c {
                    best_c = c;
                    best = cand;
                }
                off += 4;
            }
            let coarse = best;
            best_c = f32::MIN;
            for off in -3..=3 {
                let cand = clamp_pos(coarse + off);
                let c = corr(natural, cand, 1);
                if c > best_c {
                    best_c = c;
                    best = cand;
                }
            }
            // 読み終えた立ち上がりより前に戻らず、まだ鳴らしていない立ち上がりを先に鳴らさない
            if lock > 0 && best < lock {
                best = clamp_pos(lock);
            }
            if let Some(&o) = onsets.get(next).filter(|&&o| o >= best && o < best + n as i64) {
                best = clamp_pos(o - n as i64).max(best.min(lock.max(0)));
            }
            best
        };
        prev_pos = pos;

        for i in 0..n {
            let src = pos + i as i64;
            let w = window[i];
            wsum[out_start + i] += w;
            if src >= 0 && (src as usize) < len {
                for (o, c) in out.iter_mut().zip(channels) {
                    o[out_start + i] += w * c[src as usize];
                }
            }
        }
    }

    for o in out.iter_mut() {
        o.truncate(out_len);
        for (s, &w) in o.iter_mut().zip(&wsum) {
            *s = if w > 1e-3 { *s / w } else { 0.0 };
        }
    }
    out
}

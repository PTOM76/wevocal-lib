import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { View } from '../waveform/view'

/** ホイールでの拡大縮小。ctrl は Ctrl+ホイールで拡大縮小（ホイールで横スクロール）、wheel はその逆 */
export type WheelZoom = 'ctrl' | 'wheel'

/** 表示できる最小の時間幅（秒） */
export const MIN_VIEW_SEC = 0.02
/** ボタン・ホイール1回あたりの拡大率 */
export const ZOOM_STEP = 1.5
/** 再生中に、再生位置が画面の外に出たか調べる間隔（ミリ秒） */
const FOLLOW_CHECK_MS = 50

/**
 * 波形の表示範囲（拡大縮小・スクロール）。クリップの長さ変更への追従と、再生中の自動スクロールを扱う。
 * ツールバーと波形の両方から操作するため、画面側（App）で持つ。
 */
export function useWaveformView(duration: number, livePosition: () => number, playing: boolean, follow = true, trackId = '', wheelZoom: WheelZoom = 'ctrl') {
  const [view, setView] = useState<View>({ start: 0, dur: duration })
  // トラックごとの表示範囲。切り替えたら前のトラックの分を覚え、戻ったら復元する
  const saved = useRef(new Map<string, View>())
  const viewRef = useRef(view)
  const prevTrack = useRef(trackId)
  viewRef.current = view
  useEffect(() => {
    if (prevTrack.current === trackId) return
    saved.current.set(prevTrack.current, viewRef.current)
    prevTrack.current = trackId
    const v = saved.current.get(trackId)
    if (v) setView(v)
  }, [trackId])

  // 表示範囲をクリップ内に収める
  const fit = useCallback(
    (start: number, dur: number): View => {
      const d = Math.min(duration, Math.max(Math.min(MIN_VIEW_SEC, duration), dur))
      return { start: Math.max(0, Math.min(duration - d, start)), dur: d }
    },
    [duration],
  )

  /** `center`（秒）を中心に `factor` 倍に拡大する（1未満なら縮小） */
  const zoomAround = useCallback(
    (factor: number, center: number) =>
      setView((v) => {
        const dur = v.dur / factor
        return fit(center - ((center - v.start) / v.dur) * dur, dur)
      }),
    [fit],
  )

  /**
   * ホイール操作: カーソル位置を中心に拡大縮小するか、横スクロールする。`rect` は波形の位置。
   * `wheelZoom` が ctrl なら Ctrl/⌘ 併用で拡大縮小、wheel ならホイールだけで拡大縮小し Ctrl/⌘ 併用で横スクロール。
   * 横向きのホイール（トラックパッドの横スワイプ）はどちらでも横スクロール
   */
  const wheel = useCallback(
    (e: WheelEvent, rect: DOMRect) =>
      setView((v) => {
        const modifier = e.ctrlKey || e.metaKey
        const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY)
        if (!horizontal && (wheelZoom === 'wheel' ? !modifier : modifier)) {
          const center = v.start + ((e.clientX - rect.left) / rect.width) * v.dur
          const dur = v.dur / (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
          return fit(center - ((center - v.start) / v.dur) * dur, dur)
        }
        const delta = horizontal ? e.deltaX : e.deltaY
        return fit(v.start + (delta / rect.width) * v.dur, v.dur)
      }),
    [fit, wheelZoom],
  )

  // クリップが変わったら、可能なら拡大率を保ち、無理なら全体表示にする
  useEffect(() => {
    setView((v) => (v.dur > duration || v.dur <= 0 ? { start: 0, dur: duration } : fit(v.start, v.dur)))
  }, [duration, fit])

  // 再生中は再生位置が画面内に収まるようにする（`follow` が偽なら追従しない。再生しながら自由に表示範囲を動かせる）
  // （今の位置を定期的に読み、画面の外に出たときだけ表示範囲を変える。中にいる間は描き直さない）
  useEffect(() => {
    if (!playing || !follow) return
    const timer = window.setInterval(() => {
      const position = livePosition()
      setView((v) => (position < v.start || position > v.start + v.dur ? fit(position, v.dur) : v))
    }, FOLLOW_CHECK_MS)
    return () => clearInterval(timer)
  }, [livePosition, playing, fit, follow])

  // 表示範囲が変わらない限り同じオブジェクトを返す（受け取る波形を、関係ない操作で描き直さないため）
  return useMemo(
    () => ({
      view,
      zoomAround,
      wheel,
      canZoomIn: view.dur > MIN_VIEW_SEC,
      /** 表示範囲を直接決める（ピンチ操作用。クリップ内に収める） */
      setRange: (start: number, dur: number) => setView(fit(start, dur)),
      /** 表示開始位置を変える（スクロールバー用） */
      scrollTo: (start: number) => setView((v) => fit(start, v.dur)),
      showAll: () => setView({ start: 0, dur: duration }),
      /** 時刻 `t` が画面の外なら、見える位置まで表示範囲を動かす（矢印キーで再生位置を動かしたときなど） */
      reveal: (t: number) => setView((v) => (t < v.start || t > v.start + v.dur ? fit(t - v.dur * 0.1, v.dur) : v)),
      zoomed: view.dur < duration - 1e-9,
    }),
    [view, zoomAround, wheel, fit, duration],
  )
}

// プラグインの独自の画面（マニフェストの ui）。iframe の sandbox（スクリプトだけ許可。アプリの中には触れない）の中に出し、postMessage でつまみの値をやり取りする
import { useEffect, useRef } from 'react'
import type { ParamDef } from '../../../plugin-sdk'

/**
 * 画面の側（iframe の中）との約束:
 * - 親 → 画面: { wevocal: 'init', params: ParamDef[], values, texts: { キー: 訳 } }（読み込みが終わったとき）、{ wevocal: 'values', values }（値が変わったとき）
 * - 画面 → 親: { wevocal: 'ready' }（受け取る準備ができたとき）、{ wevocal: 'set', id, value }（つまみを動かしたとき）
 */
export default function PluginUi(p: { html: string; params: ParamDef[]; values: Record<string, number>; texts: Record<string, string>; onChange: (id: string, value: number) => void; height?: number }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const latest = useRef(p)
  latest.current = p

  // 画面からの知らせ（この iframe からのものだけを受ける）
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const m = e.data as { wevocal?: string; id?: unknown; value?: unknown }
      const cur = latest.current
      if (m?.wevocal === 'ready') frame.current?.contentWindow?.postMessage({ wevocal: 'init', params: cur.params, values: cur.values, texts: cur.texts }, '*')
      else if (m?.wevocal === 'set' && typeof m.id === 'string' && typeof m.value === 'number' && cur.params.some((x) => x.id === m.id)) cur.onChange(m.id, m.value)
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [])

  // 値が変わったら画面へ知らせる
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ wevocal: 'values', values: p.values }, '*')
  }, [p.values])

  return <iframe ref={frame} title="plugin" sandbox="allow-scripts" srcDoc={p.html} style={{ width: '100%', height: p.height ?? 260, border: 0, background: 'transparent' }} />
}

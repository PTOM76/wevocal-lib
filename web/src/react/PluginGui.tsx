// プラグイン自身の画面（FxPlugin.mountGui。WAM、VST の画面）をこのページの DOM に出す。画面を持たない、または standard のときは children（標準の画面）を出す
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FxPlugin, GuiHandle } from '../../../plugin-sdk'

export default function PluginGui(p: {
  plugin: FxPlugin
  values: Record<string, number>
  onChange: (id: string, value: number) => void
  /** つまみ以外の状態（保存してあるもの）と、画面で変わったときの知らせ先 */
  state?: string
  onState?: (state: string) => void
  /** true なら、プラグイン自身の画面は出さず、標準の画面（children）を出す */
  standard?: boolean
  /** プラグイン自身の画面が出せるか分かったとき（出せなければ false） */
  onAvailable?: (ok: boolean) => void
  children: ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<GuiHandle | null>(null)
  const latest = useRef(p)
  latest.current = p
  const [state, setState] = useState<'loading' | 'ok' | 'none'>('loading')

  // プラグインが変わったら作り直す
  useEffect(() => {
    let dead = false
    if (p.standard) {
      setState('none')
      return
    }
    setState('loading')
    void p.plugin.mountGui!(host.current!, latest.current.values, (id, v) => latest.current.onChange(id, v), { initial: latest.current.state, onState: (st) => latest.current.onState?.(st) }).then((h) => {
      if (dead) return h?.dispose()
      handle.current = h
      setState(h ? 'ok' : 'none')
      latest.current.onAvailable?.(!!h)
    })
    return () => {
      dead = true
      handle.current?.dispose()
      handle.current = null
    }
  }, [p.plugin, p.standard])

  // ホストの値が変わったら画面へ
  useEffect(() => handle.current?.update(p.values), [p.values])

  return (
    <>
      <div ref={host} style={{ display: state === 'ok' ? 'block' : 'none', overflow: 'auto' }} />
      {state === 'none' && p.children}
    </>
  )
}

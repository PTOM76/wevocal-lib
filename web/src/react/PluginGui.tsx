// プラグイン自身の画面（FxPlugin.mountGui。WAM の画面）をこのページの DOM に出す。画面を持たなければ children（自動の画面）を出す
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FxPlugin, GuiHandle } from '../../../plugin-sdk'

export default function PluginGui(p: { plugin: FxPlugin; values: Record<string, number>; onChange: (id: string, value: number) => void; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<GuiHandle | null>(null)
  const latest = useRef(p)
  latest.current = p
  const [state, setState] = useState<'loading' | 'ok' | 'none'>('loading')

  // プラグインが変わったら作り直す
  useEffect(() => {
    let dead = false
    setState('loading')
    void p.plugin.mountGui!(host.current!, latest.current.values, (id, v) => latest.current.onChange(id, v)).then((h) => {
      if (dead) return h?.dispose()
      handle.current = h
      setState(h ? 'ok' : 'none')
    })
    return () => {
      dead = true
      handle.current?.dispose()
      handle.current = null
    }
  }, [p.plugin])

  // ホストの値が変わったら画面へ
  useEffect(() => handle.current?.update(p.values), [p.values])

  return (
    <>
      <div ref={host} style={{ display: state === 'ok' ? 'block' : 'none', overflow: 'auto' }} />
      {state === 'none' && p.children}
    </>
  )
}

// プラグイン自身の画面（FxPlugin.mountGui。WAM、VST の画面）をこのページの DOM に出す。画面を持たない、または standard のときは children（標準の画面）を出す
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { pevenFont } from 'pevenmui'
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
  /** 拡大率のボタンの文（なければボタンを出さない） */
  zoomLabels?: { auto: string; zoomIn: string; zoomOut: string }
  children: ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<GuiHandle | null>(null)
  const latest = useRef(p)
  latest.current = p
  const [state, setState] = useState<'loading' | 'ok' | 'none'>('loading')
  // 拡大率。auto なら入る大きさにする
  const [zoom, setZoom] = useState<'auto' | number>('auto')
  const [scale, setScaleNow] = useState(1)

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

  // 拡大率を決める。auto は、窓（ポップアップでもよい）の幅と、窓の下端までの高さに入る大きさ
  useLayoutEffect(() => {
    const h = handle.current
    const el = host.current
    if (state !== 'ok' || !h?.size || !h.setScale || !el) return
    const [w, ht] = h.size
    const fit = () => {
      const win = el.ownerDocument.defaultView ?? window
      const room = win.innerHeight - el.getBoundingClientRect().top - 72
      const s = zoom === 'auto' ? Math.max(0.25, Math.min(el.clientWidth / w, Math.max(120, room) / ht)) : zoom
      h.setScale!(s)
      setScaleNow(s)
    }
    fit()
    if (zoom !== 'auto') return
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    const win = el.ownerDocument.defaultView ?? window
    win.addEventListener('resize', fit)
    return () => {
      ro.disconnect()
      win.removeEventListener('resize', fit)
    }
  }, [state, zoom])
  const step = (d: number) => setZoom(Math.max(0.25, Math.min(4, Math.round((scale + d) * 4) / 4)))
  const zl = p.zoomLabels

  return (
    <>
      {state === 'ok' && zl && handle.current?.setScale && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
          <Button size="small" sx={{ minWidth: 32 }} title={zl.zoomOut} aria-label={zl.zoomOut} onClick={() => step(-0.25)}>
            −
          </Button>
          <Typography sx={{ fontSize: pevenFont('sm'), minWidth: 44, textAlign: 'center' }}>{Math.round(scale * 100)}%</Typography>
          <Button size="small" sx={{ minWidth: 32 }} title={zl.zoomIn} aria-label={zl.zoomIn} onClick={() => step(0.25)}>
            +
          </Button>
          <Button size="small" onClick={() => setZoom('auto')} sx={{ fontWeight: zoom === 'auto' ? 'bold' : 'normal', color: zoom === 'auto' ? 'primary.main' : 'text.secondary' }}>
            {zl.auto}
          </Button>
        </Box>
      )}
      <div ref={host} style={{ display: state === 'ok' ? 'block' : 'none', overflow: 'auto' }} />
      {state === 'none' && p.children}
    </>
  )
}

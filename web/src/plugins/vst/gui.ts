// VST 自身の画面（DLL が描く画面）を FX のダイアログに出す。音を出す側（worklet）とは別に、画面用のエミュレーターを 1 つ動かして canvas に映し、
// マウスの操作を渡す。画面でつまみを動かしたら onChange で返し、ホストの値が変わったら画面のつまみへ渡す。画面を持たない DLL は null
import type { GuiHandle } from '../../../../plugin-sdk'
import type { PluginPackage } from '../external'
import { loadBridge } from './bridge'
import { JsVst } from './vstbridge.js'

/** 画面を描き直す間隔（ミリ秒） */
const FRAME_MS = 33

export async function mountVstGui(pkg: PluginPackage, el: HTMLElement, values: Record<string, number>, onChange: (id: string, value: number) => void): Promise<GuiHandle | null> {
  if (!pkg.dll) return null
  await loadBridge()
  let vst: JsVst
  let size: Int32Array
  try {
    vst = new JsVst(new Uint8Array(pkg.dll))
    if (!vst.hasEditor()) {
      vst.free()
      return null
    }
    size = vst.editorOpen()
  } catch {
    return null
  }
  const [w, h] = size
  const params = pkg.manifest.params
  const known: Record<string, number> = { ...values }
  params.forEach((p, i) => {
    if (values[p.id] !== undefined) vst.setParam(i, values[p.id])
  })

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  Object.assign(canvas.style, { display: 'block', margin: '0 auto', width: `${w}px`, height: `${h}px`, touchAction: 'none', userSelect: 'none' })
  const g = canvas.getContext('2d')!
  el.appendChild(canvas)

  let dead = false
  /** キャンバスの座標（画面の大きさに合わせて拡大縮小されても、DLL の座標に直す） */
  const pos = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect()
    return [Math.round(((e.clientX - r.left) * w) / r.width), Math.round(((e.clientY - r.top) * h) / r.height)]
  }
  const keys = (e: PointerEvent, left: boolean) => (left ? 1 : 0) | (e.ctrlKey || e.metaKey ? 2 : 0) | (e.shiftKey ? 4 : 0)
  let last = ''
  const safe = (f: () => void) => {
    try {
      f()
    } catch {
      // エミュレーターが対応していない処理で止まったら、画面を止める（音は別のインスタンスなので影響しない）
      dead = true
    }
  }
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId)
    const [x, y] = pos(e)
    safe(() => vst.editorMouse(0x201, x, y, keys(e, true)))
  }
  canvas.onpointermove = (e) => {
    const [x, y] = pos(e)
    if (`${x},${y}` === last) return
    last = `${x},${y}`
    safe(() => vst.editorMouse(0x200, x, y, keys(e, (e.buttons & 1) === 1)))
  }
  canvas.onpointerup = (e) => {
    const [x, y] = pos(e)
    safe(() => vst.editorMouse(0x202, x, y, keys(e, false)))
  }

  const timer = setInterval(() => {
    if (dead) return
    safe(() => {
      vst.editorIdle()
      const ch = vst.editorChanges()
      for (let i = 0; i + 1 < ch.length; i += 2) {
        const p = params[ch[i]]
        if (p && known[p.id] !== ch[i + 1]) {
          known[p.id] = ch[i + 1]
          onChange(p.id, ch[i + 1])
        }
      }
      const px = vst.editorFrame()
      if (px) g.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length), w, h), 0, 0)
    })
  }, FRAME_MS)

  return {
    size: [w, h],
    setScale(s) {
      // 拡大してもドットがぼやけないようにする
      canvas.style.imageRendering = s >= 1.5 ? 'pixelated' : 'auto'
      canvas.style.width = `${Math.round(w * s)}px`
      canvas.style.height = `${Math.round(h * s)}px`
    },
    update(v) {
      // ホスト側で変わったぶん（リセット、オートメーション、プリセット）だけ画面のつまみへ渡す
      safe(() =>
        params.forEach((p, i) => {
          const x = v[p.id]
          if (x !== undefined && x !== known[p.id]) {
            known[p.id] = x
            vst.setParam(i, x)
          }
        }),
      )
    },
    dispose() {
      clearInterval(timer)
      canvas.remove()
      safe(() => {
        vst.editorClose()
        vst.free()
      })
    },
  }
}

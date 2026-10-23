// VST 自身の画面（DLL が描く画面）を FX のダイアログに出す。音を出す側（worklet）とは別に、画面用のエミュレーターを 1 つ動かして canvas に映し、
// マウスの操作を渡す。画面でつまみを動かしたら onChange で返し、ホストの値が変わったら画面のつまみへ渡す。画面を持たない DLL は null。閉じた画面はいくつか開いたまま残し、次に開くときに使い回す
import type { GuiHandle } from '../../../../plugin-sdk'
import type { PluginPackage } from '../external'
import { loadBridge } from './bridge'
import { JsVst } from './vstbridge.js'

/** 画面を描き直す間隔（ミリ秒） */
const FRAME_MS = 33
/** 閉じた画面を開いたまま残しておく数。次に開くときに DLL の立ち上げ直しを省く */
const KEEP_MAX = 4
/** 閉じた画面を使わないまま残しておく時間（ミリ秒）。過ぎたら閉じてメモリを返す */
const KEEP_MS = 5 * 60 * 1000

type Editor = { id: string; vst: JsVst; size: Int32Array; timer?: ReturnType<typeof setTimeout> }
/** 閉じた画面（古い順） */
const idle: Editor[] = []

function release(e: Editor) {
  clearTimeout(e.timer)
  try {
    e.vst.editorClose()
    e.vst.free()
  } catch (error) {
    console.error('Failed to close VST editor', { id: e.id, error })
  }
}

/** 試して画面を持たなかった DLL。次からは重い読み込みをしない（入れ直せば別の DLL として試し直す） */
const noEditor = new WeakSet<ArrayBuffer>()

/** 残してある画面を使う。無ければ DLL を読み込んで開く。画面を持たない DLL は null */
function take(pkg: PluginPackage): Editor | null {
  const id = pkg.manifest.id
  if (noEditor.has(pkg.dll!)) return null
  const i = idle.findIndex((e) => e.id === id)
  if (i >= 0) {
    const e = idle.splice(i, 1)[0]
    clearTimeout(e.timer)
    return e
  }
  const vst = new JsVst(new Uint8Array(pkg.dll!))
  if (!vst.hasEditor()) {
    noEditor.add(pkg.dll!)
    vst.free()
    return null
  }
  return { id, vst, size: vst.editorOpen() }
}

/** 閉じた画面を残す。上限を超えたら古いものから閉じ、しばらく使わなければそれも閉じる */
function keep(e: Editor) {
  e.timer = setTimeout(() => {
    const i = idle.indexOf(e)
    if (i >= 0) release(idle.splice(i, 1)[0])
  }, KEEP_MS)
  idle.push(e)
  while (idle.length > KEEP_MAX) release(idle.shift()!)
}

/** 残してある画面をすべて閉じる（プロジェクトを閉じたときなど） */
export function releaseVstGuis() {
  idle.splice(0).forEach(release)
}

export async function mountVstGui(pkg: PluginPackage, el: HTMLElement, values: Record<string, number>, onChange: (id: string, value: number) => void): Promise<GuiHandle | null> {
  if (!pkg.dll) return null
  await loadBridge()
  let editor: Editor | null
  try {
    editor = take(pkg)
  } catch (error) {
    console.error('Failed to open VST editor', { id: pkg.manifest.id, error })
    return null
  }
  if (!editor) return null
  const kept = editor
  const { vst, size } = kept
  const [w, h] = size
  const params = pkg.manifest.params
  const known: Record<string, number> = { ...values }
  params.forEach((p, i) => {
    if (values[p.id] !== undefined) vst.setParam(i, values[p.id])
  })
  // 前に開いていたときに溜まった変更は捨てる
  vst.editorChanges()

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
  const safe = (operation: string, f: () => void) => {
    try {
      f()
    } catch (error) {
      // エミュレーターが対応していない処理で止まったら、画面を止める（音は別のインスタンスなので影響しない）
      if (!dead) console.error('VST editor stopped after an emulator error', { id: pkg.manifest.id, operation, error })
      dead = true
    }
  }
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId)
    const [x, y] = pos(e)
    safe('pointer down', () => vst.editorMouse(0x201, x, y, keys(e, true)))
  }
  canvas.onpointermove = (e) => {
    const [x, y] = pos(e)
    if (`${x},${y}` === last) return
    last = `${x},${y}`
    safe('pointer move', () => vst.editorMouse(0x200, x, y, keys(e, (e.buttons & 1) === 1)))
  }
  canvas.onpointerup = (e) => {
    const [x, y] = pos(e)
    safe('pointer up', () => vst.editorMouse(0x202, x, y, keys(e, false)))
  }

  const timer = setInterval(() => {
    if (dead) return
    safe('editor idle and render', () => {
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
      safe('host parameter update', () =>
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
      // 止まった画面は残さない
      if (dead) release(kept)
      else keep(kept)
    },
  }
}

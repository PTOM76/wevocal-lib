// VST のエミュレーター（wasm）の読み込み。パッケージを作る（index.ts）と画面（gui.ts）で共有する
import init from './vstbridge.js'
import wasmUrl from './vstbridge_bg.wasm?url'

let ready: Promise<ArrayBuffer> | null = null

/** wasm を読み込む（初回だけ）。processor にも同じバイト列を渡す */
export function loadBridge(): Promise<ArrayBuffer> {
  ready ??= fetch(wasmUrl)
    .then((r) => r.arrayBuffer())
    .then(async (bytes) => {
      await init({ module_or_path: bytes })
      return bytes
    })
  return ready
}

/// <reference lib="webworker" />
// VST を Worker の中で読み込み、wasm のメモリごと写して返す（snapshot.ts）。読み込みは重い（大きい DLL で十数秒）ので、画面と音のスレッドから外す
import { initSync, JsVst } from './vstbridge.js'

export interface SnapshotRequest {
  wasm: ArrayBuffer
  dll: ArrayBuffer
}

/** 写し。memory は読み込みが済んだときの wasm のメモリ、ptr は JsVst の番地、refs は externref の表の長さ */
export interface VstSnapshot {
  memory: ArrayBuffer
  ptr: number
  refs: number
}

export type SnapshotMessage = { ok: true; snap: VstSnapshot } | { ok: false; error: string }

self.onmessage = (e: MessageEvent<SnapshotRequest>) => {
  try {
    const wasm = initSync({ module: e.data.wasm })
    const vst = new JsVst(new Uint8Array(e.data.dll))
    // JS から何も呼んでいない間に写す（スタックは空で、メモリの中だけで状態が閉じている）
    const snap: VstSnapshot = { memory: wasm.memory.buffer.slice(0), ptr: (vst as unknown as { __wbg_ptr: number }).__wbg_ptr, refs: wasm.__wbindgen_externrefs.length }
    self.postMessage({ ok: true, snap } satisfies SnapshotMessage, [snap.memory])
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) } satisfies SnapshotMessage)
  }
}

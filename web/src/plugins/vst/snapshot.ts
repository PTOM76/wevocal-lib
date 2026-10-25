// 読み込みの済んだ VST の、wasm のメモリの写し（プラグインごとに 1 つ、Worker で作る）。先に作る描画や書き出しの processor は、DLL を読み込み直さずにこれから戻す
import type { PluginPackage } from '../external'
import type { SnapshotMessage, SnapshotRequest, VstSnapshot } from './snapshotWorker'

export type { VstSnapshot }

const made = new Map<string, Promise<VstSnapshot | null>>()
const done = new Map<string, VstSnapshot | null>()

/** 写しを作る（初回だけ。作れなかったら null で、processor は今までどおり DLL を読み込む） */
export function vstSnapshot(pkg: PluginPackage): Promise<VstSnapshot | null> {
  const key = `${pkg.manifest.id}@${pkg.manifest.version}`
  let p = made.get(key)
  if (!p) {
    p = new Promise<VstSnapshot | null>((resolve) => {
      if (!pkg.wasm || !pkg.dll || typeof Worker === 'undefined') return resolve(null)
      const worker = new Worker(new URL('./snapshotWorker.ts', import.meta.url), { type: 'module' })
      const finish = (s: VstSnapshot | null) => {
        worker.terminate()
        done.set(key, s)
        resolve(s)
      }
      worker.onmessage = (e: MessageEvent<SnapshotMessage>) => {
        if (!e.data.ok) console.warn(`plugin ${pkg.manifest.id}: snapshot failed`, e.data.error)
        finish(e.data.ok ? e.data.snap : null)
      }
      worker.onerror = (e) => {
        console.warn(`plugin ${pkg.manifest.id}: snapshot failed`, e.message)
        finish(null)
      }
      // 元のバイト列は processor にも渡すので、写して送る
      worker.postMessage({ wasm: pkg.wasm.slice(0), dll: pkg.dll.slice(0) } satisfies SnapshotRequest)
    })
    made.set(key, p)
  }
  return p
}

/** できていれば写しを返す（待たない） */
export const readySnapshot = (pkg: PluginPackage): VstSnapshot | null => done.get(`${pkg.manifest.id}@${pkg.manifest.version}`) ?? null

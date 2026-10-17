// 音を作る処理の負荷（AudioRenderCapacity。対応するブラウザのみ）。WeVocalSynth と WeVocal Studio で共通
import { reportTotalLoad } from './registry'

interface RenderCapacity {
  start(o: { updateInterval: number }): void
  addEventListener(t: 'update', f: (e: { averageLoad: number }) => void): void
}

const started = new WeakSet<AudioContext>()

/** ctx の負荷を測り始め、約 1 秒ごとに onLoad（0〜1）を呼ぶ。全体の負荷が続けて高ければ、一番重いプラグインを素通しにする（registry）。二度目以降や、対応していないブラウザでは何もしない */
export function startRenderLoad(ctx: AudioContext, onLoad: (load: number) => void): void {
  const rc = (ctx as AudioContext & { renderCapacity?: RenderCapacity }).renderCapacity
  if (!rc || started.has(ctx)) return
  started.add(ctx)
  rc.addEventListener('update', (e) => {
    reportTotalLoad(e.averageLoad)
    onLoad(e.averageLoad)
  })
  rc.start({ updateInterval: 1 })
}

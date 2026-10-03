// AudioContext の再生の開始と停止（iOS の消音スイッチ、一時停止の待ち合わせへの対策）

/** AudioContext ごとの、終わっていない suspend（終わる前に再生を始めると、後から止まって無音になる） */
const pendingSuspend = new WeakMap<AudioContext, Promise<void>>()

/** 再生方式の切り替え（設定の開発者向け。iOS で音が出ないときに原因を切り分けるため） */
export interface PlaybackOptions {
  /** 止めている間は AudioContext を一時停止する（切ると動かしたままにする） */
  suspendWhenStopped: boolean
  /** iOS のオーディオセッションを playback にする（消音スイッチでも鳴る）。切ると指定しない（以前の動作） */
  playbackSession: boolean
  /** 開始や停止のたびに状態を知らせる（デバッグ表示用）。`error` は動かせなかったときの理由 */
  report?: (name: string, ctx: AudioContext, error?: string | null) => void
}

const options: PlaybackOptions = { suspendWhenStopped: true, playbackSession: true }

export function configurePlayback(o: Partial<PlaybackOptions>) {
  Object.assign(options, o)
}

/**
 * iOS で、マナーモード（消音スイッチ）でも鳴らす。指定しないと Web Audio は環境音の扱いになり、消音スイッチで無音になる。
 * 対応していないブラウザでは何もしない
 */
function setPlaybackSession() {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (options.playbackSession && session && session.type !== 'playback') {
    try {
      session.type = 'playback'
    } catch {
      // 設定できない環境ではそのまま
    }
  }
}

/**
 * 再生の前に AudioContext を動かす。ユーザー操作の中で呼ぶ（iOS は操作の中の resume しか受け付けない）。
 * resume は await の前に呼ぶ。`suspended` だけでなく iOS の `interrupted`（電話・ほかのアプリの音などで止まった状態）でも呼ぶ。
 * 終わっていない suspend があれば、終わるのを待ってから動いているか確かめ直す
 */
export async function startContext(ctx: AudioContext, name: string) {
  setPlaybackSession()
  const first = ctx.state !== 'running' ? ctx.resume() : null
  let error: string | null = null
  try {
    await pendingSuspend.get(ctx)
    await first
    if (ctx.state !== 'running') await ctx.resume()
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  options.report?.(name, ctx, error)
}

/** 止まっている間の音声処理を止める。終わるまでは `startContext` が待つ */
export function suspendContext(ctx: AudioContext, name: string) {
  if (!options.suspendWhenStopped || ctx.state !== 'running') return
  const p = ctx
    .suspend()
    .catch(() => {})
    .finally(() => {
      if (pendingSuspend.get(ctx) === p) pendingSuspend.delete(ctx)
      options.report?.(name, ctx)
    })
  pendingSuspend.set(ctx, p)
}

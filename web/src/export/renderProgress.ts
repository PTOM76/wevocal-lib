// OfflineAudioContext の描画を、進み具合を知らせながら行う（描画の途中で何度か止めて、位置を割合にして知らせる）

/** 描画する。onProgress には 0〜1 を、約 1 秒の音ごとに（多くても 50 回）渡す */
export async function renderWithProgress(ctx: OfflineAudioContext, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<AudioBuffer> {
  signal?.throwIfAborted()
  const total = ctx.length
  const steps = Math.min(50, Math.floor(total / ctx.sampleRate))
  // 止める位置は 128 フレームの倍数。短い音は止めずにそのまま描画する
  let rejectCancelled: (reason: DOMException) => void = () => {}
  const cancelled = new Promise<never>((_, reject) => (rejectCancelled = reject))
  const abort = () => {
    const frame = Math.ceil((ctx.currentTime * ctx.sampleRate + 128) / 128) * 128
    const error = new DOMException('Rendering was cancelled', 'AbortError')
    if (frame >= ctx.length) {
      rejectCancelled(error)
      return
    }
    void ctx.suspend(frame / ctx.sampleRate).then(
      () => rejectCancelled(error),
      () => rejectCancelled(error),
    )
  }
  signal?.addEventListener('abort', abort, { once: true })
  if (onProgress) {
    for (let i = 1; i <= steps; i++) {
      const frame = Math.floor(((total * i) / (steps + 1)) / 128) * 128
      ctx
        .suspend(frame / ctx.sampleRate)
        .then(() => {
          if (signal?.aborted) {
            rejectCancelled(new DOMException('Rendering was cancelled', 'AbortError'))
            return
          }
          onProgress(frame / total)
          return ctx.resume()
        })
        .catch(() => {})
    }
  }
  const rendering = ctx.startRendering()
  if (!signal) {
    const out = await rendering
    onProgress?.(1)
    return out
  }
  try {
    const out = await Promise.race([rendering, cancelled])
    onProgress?.(1)
    return out
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

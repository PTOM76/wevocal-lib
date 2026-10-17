// OfflineAudioContext の描画を、進み具合を知らせながら行う（描画の途中で何度か止めて、位置を割合にして知らせる）

/** 描画する。onProgress には 0〜1 を、約 1 秒の音ごとに（多くても 50 回）渡す */
export async function renderWithProgress(ctx: OfflineAudioContext, onProgress?: (p: number) => void): Promise<AudioBuffer> {
  if (!onProgress) return ctx.startRendering()
  const total = ctx.length
  const steps = Math.min(50, Math.floor(total / ctx.sampleRate))
  // 止める位置は 128 フレームの倍数。短い音は止めずにそのまま描画する
  for (let i = 1; i <= steps; i++) {
    const frame = Math.floor(((total * i) / (steps + 1)) / 128) * 128
    ctx
      .suspend(frame / ctx.sampleRate)
      .then(() => {
        onProgress(frame / total)
        return ctx.resume()
      })
      .catch(() => {})
  }
  const out = await ctx.startRendering()
  onProgress(1)
  return out
}

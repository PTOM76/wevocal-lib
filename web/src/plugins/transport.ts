// プラグインに伝える再生の位置。揺れなど、曲の位置に合わせて動くプラグインのためのもの
export interface Transport {
  /** 曲の位置 0 にあたる、AudioContext の時刻（秒） */
  zero: number
  bpm: number
}

/** setTransport を持つ項目（持たないプラグインは何もしない） */
export interface TransportAware {
  setTransport(t: Transport): void
}

export const isTransportAware = (x: unknown): x is TransportAware => typeof (x as Partial<TransportAware> | null)?.setTransport === 'function'

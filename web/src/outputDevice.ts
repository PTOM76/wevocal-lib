// 音声の出力先（AudioContext.setSinkId。対応していないブラウザでは既定の出力のまま）

type SinkContext = AudioContext & { sinkId?: string | object; setSinkId?: (id: string) => Promise<void> }

/** 出力先のデバイス ID（'' は既定の出力） */
let sinkId = ''
/** 出力先を合わせた AudioContext（変えたときに鳴っているものにも反映する） */
const contexts = new Set<WeakRef<SinkContext>>()

/** このブラウザで出力先を選べるか */
export const canSelectOutput = () => typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype

/** 出力先を変える。開いている AudioContext にもすぐ反映する */
export function setOutputDevice(id: string) {
  sinkId = id
  for (const ref of contexts) {
    const ctx = ref.deref()
    if (!ctx || ctx.state === 'closed') contexts.delete(ref)
    else void applyOutputDevice(ctx)
  }
}

/** `ctx` の出力先を設定に合わせる。デバイスが見つからなければ既定の出力のまま（`startContext` が呼ぶ） */
export async function applyOutputDevice(ctx: AudioContext) {
  const c = ctx as SinkContext
  if (!c.setSinkId) return
  if (![...contexts].some((r) => r.deref() === c)) contexts.add(new WeakRef(c))
  const cur = typeof c.sinkId === 'string' ? c.sinkId : ''
  if (cur === sinkId) return
  try {
    await c.setSinkId(sinkId)
  } catch {
    // 抜いたデバイスなど
    if (cur !== '') await c.setSinkId('').catch(() => {})
  }
}

export interface OutputDevice {
  id: string
  /** デバイス名（マイクの許可がないと空のことがある） */
  label: string
}

/** 出力先の一覧（既定の出力は含めない） */
export async function listOutputDevices(): Promise<OutputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const all = await navigator.mediaDevices.enumerateDevices()
  return all.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ id: d.deviceId, label: d.label }))
}

/** デバイス名を見えるようにする（マイクの許可を求め、すぐ止める）。許可されたか */
export async function revealDeviceLabels() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}

// プラグインのプリセットの書き出しと読み込み（JSON ファイル）。WeVocalSynth と WeVocal Studio で共通
export interface PresetItem {
  name: string
  params: Record<string, number>
}

/** 書き出すファイルの中身 */
export function presetsToJson(plugin: string, list: PresetItem[]): string {
  return JSON.stringify({ wevocalPresets: 1, plugin, presets: list }, null, 2)
}

/** 読み込んだファイルからプリセットを取り出す。形が違う、別のプラグインのものなら null。つまみの値は数値だけ残す */
export function presetsFromJson(text: string, plugin: string): PresetItem[] | null {
  let raw: { wevocalPresets?: number; plugin?: string; presets?: unknown }
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (raw?.wevocalPresets !== 1 || raw.plugin !== plugin || !Array.isArray(raw.presets)) return null
  return raw.presets.flatMap((p: { name?: unknown; params?: unknown }) => {
    if (typeof p?.name !== 'string' || !p.name.trim() || !p.params || typeof p.params !== 'object') return []
    const params = Object.fromEntries(Object.entries(p.params as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>
    return [{ name: p.name.trim(), params }]
  })
}

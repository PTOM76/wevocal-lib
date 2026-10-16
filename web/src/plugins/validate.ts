// プラグインのマニフェストの検査（URL から足すもの。信用しない入力として形を確かめる）
import type { ParamDef, PluginManifest } from '../../../plugin-sdk'

export type PluginErrorCode = 'fetch' | 'manifest' | 'api' | 'kind' | 'format' | 'id' | 'processor' | 'reserved'

export class PluginError extends Error {
  readonly code: PluginErrorCode

  constructor(code: PluginErrorCode) {
    super(code)
    this.code = code
  }
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)

/** 標準のプラグインの id（外から足せない） */
const RESERVED = /^wevocal\./

/** 外から来た JSON をマニフェストにする。形が違えば PluginError */
export function validateManifest(raw: unknown): PluginManifest {
  const m = raw as Partial<PluginManifest> | null
  if (!m || typeof m !== 'object') throw new PluginError('manifest')
  if (m.api !== 1) throw new PluginError('api')
  if (m.kind !== 'fx' && m.kind !== 'instrument') throw new PluginError('kind')
  if (m.format !== 'wevocal') throw new PluginError('format')
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(m.id)) throw new PluginError('id')
  if (RESERVED.test(m.id)) throw new PluginError('reserved')
  if (!Array.isArray(m.params)) throw new PluginError('manifest')
  const params: ParamDef[] = m.params.map((p: Partial<ParamDef>) => {
    if (typeof p?.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(p.id)) throw new PluginError('manifest')
    const min = num(p.min, 0)
    const max = Math.max(min, num(p.max, 1))
    return {
      id: p.id,
      name: str(p.name, `param.${p.id}`),
      min,
      max,
      default: Math.max(min, Math.min(max, num(p.default, min))),
      ...(p.step ? { step: num(p.step, 0) || undefined } : {}),
      ...(p.unit ? { unit: p.unit } : {}),
      ...(p.log ? { log: true } : {}),
      ...(Array.isArray(p.choices) ? { choices: p.choices.map(String) } : {}),
    }
  })
  return {
    id: m.id,
    api: 1,
    kind: m.kind,
    format: 'wevocal',
    version: str(m.version, '0.0.0'),
    author: str(m.author, '?'),
    name: str(m.name, 'name'),
    params,
    ...(m.realtime === false ? { realtime: false } : {}),
    ...(m.latency ? { latency: num(m.latency, 0) } : {}),
    ...(m.tail ? { tail: Math.max(0, num(m.tail, 0)) } : {}),
    ...(Array.isArray(m.permissions) ? { permissions: m.permissions.map(String) } : {}),
    ...(m.sidechain ? { sidechain: true } : {}),
    ...(m.ui ? { ui: str(m.ui) } : {}),
    ...(m.processor ? { processor: str(m.processor) } : {}),
    ...(m.wasm ? { wasm: str(m.wasm) } : {}),
    ...(m.migrate ? { migrate: m.migrate } : {}),
    ...(m.presets ? { presets: m.presets } : {}),
    ...(m.lang && typeof m.lang === 'object' ? { lang: m.lang } : {}),
  }
}

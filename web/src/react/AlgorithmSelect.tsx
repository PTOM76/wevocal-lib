// 処理方式の選択ボックス（波形ブロックのプロパティ、音源、設定で共通）。一覧の出し方は pevenmui の DescribedSelect
import { DescribedSelect } from 'pevenmui'
import { visibleAlgorithms, type Algorithm, type AlgorithmKey } from '../algorithm'

export default function AlgorithmSelect(p: {
  /** 選んでいる方式。複数が混ざっているときは空 */
  value: Algorithm | ''
  onChange: (a: Algorithm) => void
  /** 従来の方式も表示する */
  showLegacy: boolean
  /** 隠さない方式（今使っているもの） */
  keep?: Algorithm[]
  /** 省くと枠の上の名前を付けない（設定の行など、名前が別にあるとき） */
  label?: string
  t: (key: AlgorithmKey) => string
}) {
  const options = visibleAlgorithms(p.showLegacy, p.keep ?? (p.value ? [p.value] : [])).map((a) => ({ value: a.value, label: p.t(a.label), hint: p.t(a.hint) }))
  return <DescribedSelect label={p.label} value={p.value} options={options} onChange={p.onChange} />
}

// 処理方式の選択ボックス。開いた一覧には説明を付け、閉じているときは名前だけにする（波形ブロックのプロパティ、音源、設定で共通）
import { ListItemText, MenuItem, TextField } from '@mui/material'
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
  const list = visibleAlgorithms(p.showLegacy, p.keep ?? (p.value ? [p.value] : []))
  return (
    <TextField
      select
      size="small"
      fullWidth
      label={p.label}
      value={p.value}
      slotProps={{ select: { renderValue: (v) => { const a = list.find((x) => x.value === v); return a ? p.t(a.label) : '' } } }}
      onChange={(e) => p.onChange(e.target.value as Algorithm)}
    >
      {list.map((a) => (
        <MenuItem key={a.value} value={a.value}>
          <ListItemText primary={p.t(a.label)} secondary={p.t(a.hint)} />
        </MenuItem>
      ))}
    </TextField>
  )
}

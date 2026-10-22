// エフェクトを選んで追加する一覧（名前で探せる。FX のダイアログの右側に出す）。Enter で一番上のものを追加する
import { Fragment, useState } from 'react'
import { Box, Button, ButtonBase, InputBase, Typography } from '@mui/material'
import { pevenFont } from 'pevenmui'
import type { FxPlugin } from '../../../plugin-sdk'
import { fxDescription, fxText } from '../plugins/host'

// タッチ端末では、開いただけで画面のキーボードが出ないよう、自動でフォーカスしない
const finePointer = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches

export default function FxAddPicker(p: { plugins: FxPlugin[]; lang: string; onPick: (plugin: FxPlugin) => void; onCancel: () => void; labels: { search: string; none: string; cancel: string } }) {
  const [q, setQ] = useState('')
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  // 名前（どの言語でも）、id、作者のどれかに、入れた言葉がすべて含まれるもの
  const hits = p.plugins.filter((pl) => {
    const hay = [...Object.values(pl.lang).flatMap((l) => [l.name ?? '', l.description ?? '', l.keywords ?? '']), pl.manifest.id, pl.manifest.author].join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 1, minWidth: 0, minHeight: 0 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <InputBase
          autoFocus={finePointer}
          fullWidth
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={p.labels.search}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) p.onPick(hits[0])
            else if (e.key === 'Escape') {
              e.stopPropagation()
              p.onCancel()
            }
          }}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 0.5, px: 1, height: 32, fontSize: pevenFont('base'), '&:focus-within': { borderColor: 'primary.main' } }}
        />
        <Button size="small" onClick={p.onCancel} sx={{ flexShrink: 0 }}>
          {p.labels.cancel}
        </Button>
      </Box>
      {!hits.length && <Typography sx={{ fontSize: pevenFont('base'), color: 'text.secondary' }}>{p.labels.none}</Typography>}
      <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
        {hits.map((pl) => (
          <Fragment key={pl.manifest.id}>
            <ButtonBase onClick={() => p.onPick(pl)} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.25, px: 1, py: 0.75, borderRadius: 0.5, textAlign: 'left', '&:hover': { bgcolor: 'action.hover' } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2, width: '100%' }}>
                <Typography sx={{ fontSize: pevenFont('base') }}>{fxText(pl, 'name', p.lang)}</Typography>
                <Typography noWrap sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>
                  {pl.manifest.author}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{fxDescription(pl, p.lang)}</Typography>
            </ButtonBase>
          </Fragment>
        ))}
      </Box>
    </Box>
  )
}

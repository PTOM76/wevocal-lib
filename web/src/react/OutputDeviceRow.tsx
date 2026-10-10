// 設定の「音声の出力先」の行（WeVocalSynth と WeVocal Studio で共通。訳文はアプリの t を渡す）
import { useEffect, useState } from 'react'
import { Button } from '@mui/material'
import { Choice, Row } from 'pevenmui'
import { canSelectOutput, listOutputDevices, revealDeviceLabels, type OutputDevice } from '../outputDevice'

/** この行が使う訳文のキー */
export type OutputDeviceKey = 'settings.outputDevice' | 'settings.outputUnsupported' | 'settings.outputDefault' | 'settings.outputUnnamed' | 'settings.outputMissing' | 'settings.outputDeviceHelp' | 'settings.outputShowNames'

/** 設定の「音声の出力先」。デバイスを抜き差ししたら一覧を読み直す */
export default function OutputDeviceRow({ value, onChange, t }: { value: string; onChange: (id: string) => void; t: (key: OutputDeviceKey, vars?: Record<string, string | number>) => string }) {
  const [devices, setDevices] = useState<OutputDevice[]>([])
  const supported = canSelectOutput()
  useEffect(() => {
    if (!supported) return
    const load = () => void listOutputDevices().then(setDevices)
    load()
    navigator.mediaDevices?.addEventListener('devicechange', load)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load)
  }, [supported])
  if (!supported) return <Row label={t('settings.outputDevice')} help={t('settings.outputUnsupported')}>{null}</Row>
  const options: [string, string][] = [['default', t('settings.outputDefault')], ...devices.map((d, i): [string, string] => [d.id, d.label || t('settings.outputUnnamed', { n: i + 1 })])]
  // 保存した出力先が今は無い（抜いた）とき。既定の出力で鳴る
  if (value && !devices.some((d) => d.id === value)) options.push([value, t('settings.outputMissing')])
  const unnamed = devices.some((d) => !d.label)
  return (
    <Row label={t('settings.outputDevice')} help={t('settings.outputDeviceHelp')}>
      {/* 選択欄は空の値を表示しないので、既定の出力は 'default' で表す */}
      <Choice<string> value={value || 'default'} onChange={(v) => onChange(v === 'default' ? '' : v)} options={options} />
      {unnamed && (
        <Button size="small" onClick={async () => (await revealDeviceLabels()) && setDevices(await listOutputDevices())}>
          {t('settings.outputShowNames')}
        </Button>
      )}
    </Row>
  )
}

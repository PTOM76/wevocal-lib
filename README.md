# wevocal-lib
WeVocalSynthとWeVocalExtractorで共通利用する信号処理ライブラリ

| モジュール | 内容 |
| --- | --- |
| `fft` | radix-2 FFT（回転因子を段ごとに連続して並べ、SIMD が効くようにしている） |
| `stft` | STFT / 逆STFT（周期的な Hann 窓、center なし。逆変換は窓を掛けて足し込み、窓の2乗の和で割る） |
| `resample` | 窓付き sinc 補間。上げるときはカットオフを下げて折り返しを防ぐ |

```sh
cargo test --release
```

## TypeScript（`web/`）
音声ファイルの読み込みと書き出し、再生の開始と停止、録音、波形の表示の土台。WeVocalSynth と WeVocalExtractor（と WeVocalAnalyzer）で共通に使う。ソースのまま読み込み、`wevocal-lib` を `web/src/index.ts` に、`wevocal-lib/react` を `web/src/react/index.ts` に向ける。React を使わないアプリ（ライブラリや Worker）は `wevocal-lib` だけを読み込む（react は任意の `peerDependencies`）。

| ファイル | 内容 |
| --- | --- |
| `decode.ts` | 音声ファイルのデコード（WAV・MP4 は元のサンプルレートのまま） |
| `wav.ts` | WAV の書き出し（16 / 24bit・32bit float） |
| `export/` | 書き出し（WAV / MP3 / Opus）。範囲の切り出し・モノラル化・サンプルレートの変換も行う。MP3 は lamejs（LGPL-3.0、`peerDependencies`）を Worker で使い、Opus は WebCodecs で作る |
| `playback.ts` | AudioContext の開始と停止。iOS では消音スイッチが入っていても鳴るように、オーディオセッションを playback にする。一時停止が終わる前に再生を始めて無音になるのも防ぐ |
| `waveform/` | 波形の表示の土台（React なし）。表示範囲（`View`）、ピーク（`computePeaks`。最小値・最大値のピラミッドをクリップごとに作って使い回す。作ったときの計測は `setPeaksOnBuild` で渡す）、色（`WaveColors`、`alpha`）、Canvas への描画（目盛り、波形、ほかのトラックの薄い波形、選択範囲とつまみ、再生位置）。色はアプリのテーマから作って渡す |
| `react/` | 波形の React のフックと部品（`wevocal-lib/react`）。`useWaveformView`（表示範囲、ズーム、再生中の追従）、`useTouchGestures`（ピンチ、目盛りの操作）、`useEdgeScroll`、`useRangeEdges`、`Minimap`、`LevelMeter`（LED 風の音量メーター。AnalyserNode のピークを Canvas に描く。色と解像度はアプリから渡す） |

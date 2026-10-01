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
音声ファイルの読み込みと書き出し。WeVocalSynth と WeVocalExtractor で共通に使う（ソースのまま読み込み、`wevocal-lib` を `web/src/index.ts` に向ける）。

| ファイル | 内容 |
| --- | --- |
| `decode.ts` | 音声ファイルのデコード（WAV・MP4 は元のサンプルレートのまま） |
| `wav.ts` | WAV の書き出し（16 / 24bit・32bit float） |
| `export/` | 書き出し（WAV / MP3 / Opus）。範囲の切り出し・モノラル化・サンプルレートの変換も行う。MP3 は lamejs（LGPL-3.0、`peerDependencies`）を Worker で使い、Opus は WebCodecs で作る |

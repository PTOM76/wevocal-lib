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

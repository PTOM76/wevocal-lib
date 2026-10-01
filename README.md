# wevocal-lib
WeVocalSynth と WeVocalExtractor で共有する信号処理の部品（Rust）。

| モジュール | 内容 |
| --- | --- |
| `fft` | radix-2 FFT（回転因子を段ごとに連続して並べ、SIMD が効くようにしている） |
| `resample` | 窓付き sinc 補間。上げるときはカットオフを下げて折り返しを防ぐ |

```sh
cargo test --release
```

## ライセンス
MIT

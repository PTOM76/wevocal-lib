# wevocal-lib
WeVocalSynth、WeVocal Studio、WeVocalExtractor、WeVocalAnalyzer、WeVocalConverter で共通に使う、音声の処理と音声まわりの部品。

| 場所 | 内容 |
| --- | --- |
| `src/` | 信号処理（Rust。wasm にして使う）。ピッチ変更、時間伸縮、フォルマント補正、解析 |
| `web/` | 音声ファイルの読み込みと書き出し、再生、録音、波形、エフェクトとプラグイン（TypeScript） |
| `plugin-sdk/` | WeVocal プラグインを作る人向けの SDK（型、基底クラス、雛形、ビルドツール） |

どこに何があるかは、各ファイルの 1 行目に説明がある。WeVocalSynth の `npm run map -- wevocal-lib` で一覧にできる。

## 信号処理（`src/`、Rust）
```sh
cargo test --release
```

| モジュール | 内容 |
| --- | --- |
| `pipeline` | ピッチ変更、時間伸縮、フォルマント補正をまとめた処理の流れ |
| `psola`、`sola`、`sola2`、`wsola`、`pv`、`hpss`、`sms` | 時間伸縮の処理方式（TD-PSOLA、SOLA、SOLAv2、WSOLA、Phase Vocoder、HPSS、SMS）。方式の説明は WeVocalSynth の docs/ALGORITHM.md |
| `timemap` | 伸縮処理で使う、出力位置から入力位置への対応 |
| `curve` | ピッチカーブ編集（時間ごとに変わるピッチ比で、長さを変えずにピッチを変える） |
| `formant` | スペクトル包絡（フォルマント）の補正 |
| `f0` | YIN 法による F0 推定 |
| `lpc` | 線形予測（フォルマントの推定に使う） |
| `onset` | 音の立ち上がり（破裂音、打楽器など）の検出 |
| `tempo` | テンポ（BPM）の自動解析 |
| `voices/` | 和音を 2 つの声に分ける（試作） |
| `segment` | 区間に分けて並列に加工する（試験的） |
| `fft`、`stft` | FFT（radix-2 と、3・5・15 などの小さな奇数との組み合わせ。SIMD が効く並べ方）、STFT / 逆STFT |
| `resample` | 窓付き sinc 補間。上げるときはカットオフを下げて折り返しを防ぐ |
| `window`、`math` | 窓関数、小さな数値計算（速い近似の ln / exp、位相の折り返しなど） |

## TypeScript（`web/`）
ソースのまま読み込み、`wevocal-lib` を `web/src/index.ts` に、`wevocal-lib/react` を `web/src/react/index.ts` に向ける。React を使わないアプリ（ライブラリや Worker）は `wevocal-lib` だけを読み込む（react は任意の `peerDependencies`）。

### 音声の読み込みと書き出し、再生、録音
| ファイル | 内容 |
| --- | --- |
| `decode.ts`、`aiff.ts` | 音声ファイルのデコード（WAV・MP4 は元のサンプルレートのまま。AIFF は自前） |
| `wav.ts` | WAV の書き出し（16 / 24bit・32bit float） |
| `export/` | 書き出し（WAV / FLAC / MP3 / Opus / AAC）。範囲の切り出し、モノラル化、サンプルレートの変換も行う。MP3 は lamejs（LGPL-3.0、`peerDependencies`）を Worker で使い、Opus と AAC（M4A）は WebCodecs で作る。FLAC は自前のエンコーダーを Worker で使う |
| `playback.ts`、`outputDevice.ts`、`outputLimit.ts` | AudioContext の開始と停止（iOS では消音スイッチが入っていても鳴るようにする）、出力先の選択、鳴らす音の上限（リミッター） |
| `record.ts` | 入力元の一覧と、圧縮しない録音 |
| `wvsp.ts` | WeVocalSynth のプロジェクトファイル（.wvsp）の読み書き |

### 編集と音の計算
| ファイル | 内容 |
| --- | --- |
| `algorithm.ts` | ピッチ変更と時間伸縮の処理方式の名前（Rust 側と対応） |
| `clipEdit.ts`、`silence.ts` | 範囲への音量、フェード、ノーマライズ。無音で区切って音のある所を探す |
| `pitchTools.ts`、`notes.ts` | ピッチの曲線の一括操作（平らにする、音程に揃える、ビブラート、MIDI に合わせる）、音名 |
| `tempoMap.ts`、`tempoChange.ts` | テンポが途中で変わる曲の区間ごとのテンポと拍の位置、テンポの変わる所の検出 |
| `midi.ts`、`sampler.ts`、`synth.ts` | 標準 MIDI ファイルの読み書き、音声を MIDI の音符に並べる型、音を 0 から作る（声の母音、楽器の波形） |
| `history.ts`、`historyStore.ts` | 元に戻す、やり直すの状態と、それを持つストア（React の外） |
| `effects/` | トラックに掛けるもの（グラフィック EQ、フェーダー）の計算 |

### プラグイン（`plugins/`）
| ファイル | 内容 |
| --- | --- |
| `host.ts`、`registry.ts`、`store.ts` | WeVocal プラグインのホストと標準のプラグインの一覧、導入したプラグインの登録簿、URL からの導入と保存 |
| `compressor.ts`、`delay.ts`、`reverb.ts` など | 標準のプラグイン（コンプレッサー、ディレイ、リバーブ、フィルター、ゲート、ディエッサー、コーラスなど） |
| `pitch.ts`、`pitchPsola.ts` | WevPitch（再生中にピッチとフォルマントを変える）と、その処理方式 Vedict |
| `instruments.ts`、`tools.ts` | 音源（シンセ、サンプラー）、解析と編集の道具 |
| `automation.ts`、`autoValue.ts` | オートメーション（つまみを曲の時間に沿って変える） |
| `external.ts`、`validate.ts` | 外から足したプラグイン（AudioWorklet）と、マニフェストの検査 |
| `stream/` | Worker で processor 方式のプラグインを回す仕組み |
| `wam/` | WebAudio Modules 2.0 の読み込み |
| `vst/` | VST のエミュレーター（試験的機能） |

### 波形の表示（`waveform/`、`react/`）
| ファイル | 内容 |
| --- | --- |
| `waveform/` | 波形の表示の土台（React なし）。表示範囲（`View`）、ピーク（`computePeaks`）、色、Canvas への描画（目盛り、波形、選択範囲とつまみ、再生位置）。色はアプリのテーマから作って渡す |
| `react/` | 波形の React のフックと部品（`wevocal-lib/react`）。`useWaveformView`（表示範囲、ズーム、再生中の追従）、`useTouchGestures`、`useEdgeScroll`、`useRangeEdges`、`Minimap`、`LevelMeter` |

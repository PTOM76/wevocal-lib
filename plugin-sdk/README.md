# WeVocal プラグインの作り方

WeVocal Studio と WeVocalSynth の FX（エフェクト）に差し込める部品の作り方。今作れるのは、AudioWorklet で動く FX プラグイン（`kind: "fx"`、`format: "wevocal"`）。

## 構成

```
my-plugin/
  manifest.json
  lang/ja_jp.json    { "name": "ゲイン", "param.gain": "ゲイン" }
  lang/en_us.json    { "name": "Gain", "param.gain": "Gain" }
  src/processor.js
```

雛形は `template-processor/` にある。道具で写して始める。

```
node plugin-sdk/scripts/wevocal-plugin.mjs create my-plugin my.gain
node plugin-sdk/scripts/wevocal-plugin.mjs check my-plugin
node plugin-sdk/scripts/wevocal-plugin.mjs test my-plugin
node plugin-sdk/scripts/wevocal-plugin.mjs build my-plugin
```

`test` は processor を Node の中で動かし、決まった音（正弦波、雑音、インパルス）を通した結果を前回のもの（`test/baseline.json`）と比べる。遅れ、余韻、処理時間も表示する。意図した変更なら `--update` で書き直す。

`build` は `dist/` に `manifest.json`（訳文を `lang` に入れたもの）と `processor.js`（と wasm）を出す。配るのはこの中身だけ。

`lang/` の `name` は一覧に出す名前、`description` は一覧の名前の下とツールチップに出す説明、`keywords` は一覧の検索にだけ使う言葉（別の言語の名前や言い換え）。`description` と `keywords` は省略できる。

## manifest.json

| 項目 | 内容 |
| --- | --- |
| `id` | 小文字の英数字と `.` `_` `-`。`wevocal.` から始まるものは標準のプラグイン用で使えない |
| `api` | 1 |
| `kind` | `fx` |
| `format` | `wevocal` |
| `version`、`author` | 版と作者。導入のとき利用者に見せる |
| `name` | 訳文のキー |
| `params` | つまみの一覧。`id`、`name`（訳文のキー）、`min`、`max`、`default`、`step`、`unit`（`%` `dB` `Hz` `ms` `s`）、`log`（対数のつまみ）、`choices`（選択肢の訳文のキー。値は index） |
| `processor` | processor のファイル |
| `wasm` | 任意。processor の `options.processorOptions.wasm` に ArrayBuffer で渡す |
| `permissions` | 求める権限。導入のとき利用者に見せる（今は宣言のみ） |
| `tail` | 余韻の秒。曲の終わりの計算に使う |
| `latency` | 遅れ（サンプル）。遅れが違うトラックを、ホストが入口で遅らせてそろえる |
| `realtime` | `false` なら書き出し専用。再生中は素通しで、書き出しのときだけ掛かる |
| `anticipative` | `false` なら、先に計算して鳴らす対象にしない（乱数や時刻で音が変わるものなど）。既定は対象 |
| `sidechain` | `true` なら二つ目の入力（サイドチェーン）を持つ。利用者が、音を取るトラックを選べる |
| `ui` | 独自の画面の HTML（無ければつまみから自動で作る）。下の「独自の画面」 |
| `presets` | 同梱のプリセット（`name` と `values`） |
| `migrate` | 古い `param` の id から新しい id への読み替え |

## processor

- 1 つのファイルにまとめる（`import` は使えない。バンドラーで固める）
- `registerProcessor` する名前は `wevocal-fx-` に id の英数字以外を `-` にしたものを付ける（`my.gain` なら `wevocal-fx-my-gain`）
- つまみは `params` の `id` と同じ名前の `AudioParam`。`parameterDescriptors` に同じ名前で定義する。値は 128 サンプルごと（長さ 1 なら一定）
- `process` の中で確保しない。状態はプラグインの中に持つ
- 重い処理は wasm にして、`process` から 128 サンプルにつき 1 回だけ呼ぶ

- サイドチェーンを持つ processor は、`inputs[1]` を読む（何もつながっていなければ空）。`numberOfInputs` はホストが 2 にする
- つまみ以外の状態は、`this.port.postMessage({ __wevocalState: '文字列' })` で知らせる。ホストがプロジェクトに保存し、次に作るときに `options.processorOptions.state` で渡し、ほかの場所で変わったときは `port.onmessage` の `{ __wevocalSetState: 文字列 }` で知らせる（文字列は base64 などにする）

## 音源のプラグイン

`kind` を `instrument` にすると、MIDI の音符を鳴らす音源になる（トラックの「音源…」で選ぶ）。processor は入力を持たず（`numberOfInputs` は 0）、音を出力する。つまみは FX と同じく `params`。音符は port で届く:

- `{ __wevocalNotes: [{ time, dur, pitch, vel }] }`: 時刻（AudioContext の秒）に鳴らし、`dur` 秒後に離す音符。先に送られるので、時刻になったサンプルで始める（`currentTime` と `sampleRate` から求める）
- `{ __wevocalNoteOn: { pitch, vel } }`、`{ __wevocalNoteOff: { pitch } }`: すぐ鳴らす、離す（キーボード）
- `{ __wevocalClear: true }`: 音符をすべて取り消し、鳴っている音を離す
- `{ __wevocalSample: { channels, sampleRate } }`: 音色にする元の音（マニフェストの params に `sample` がある音源へ、サンプラー型）

書き出しのときは、音符が `processorOptions.events` で全部渡される。標準のシンセとサンプラーの processor（`web/src/plugins/instruments.ts`）が見本になる。

## 道具と解析のプラグイン

`kind` を `tool`（音を加工する道具）か `analyzer`（音を調べて結果を出す解析）にすると、選んだ波形ブロックの音に対して実行できる。processor には、classic script で `registerTool(fn)` を呼ぶ。`fn(input, values)` は、`input`（`{ channels: Float32Array[], sampleRate }`）と、つまみの値 `values` を受け取り、結果（同期でも Promise でもよい）を返す:

- 道具: `{ channels: Float32Array[] }`（加工した音。長さは変えてよい）
- 解析: `{ rows: [{ key, value, unit? }] }`（`key` は `lang` の訳文のキー。画面に一覧で出る）

processor は Worker の中で動くので、アプリの中の物には触れず、音と値だけをやり取りする。標準の道具（ノーマライズ、逆再生、直流成分の除去、モノラル）と解析（ラウドネスとピーク、スペクトルの特徴）の関数が、`web/src/plugins/toolsStandard.ts` にある。

## 独自の画面

マニフェストの `ui` に HTML を指定すると、FX のダイアログのつまみの代わりにその画面を出す。画面は iframe の sandbox（スクリプトだけ許可。アプリの中には触れない）の中で動き、`postMessage` でやり取りする。

- 画面 → ホスト: `{ wevocal: 'ready' }`（受け取る準備ができたとき）、`{ wevocal: 'set', id, value }`（つまみを動かしたとき）
- ホスト → 画面: `{ wevocal: 'init', params, values, texts }`（最初）、`{ wevocal: 'values', values }`（値が変わったとき）

## 安全と負荷

- プラグインは、アプリと同じ場所（同じ AudioContext の同じスレッド）で動き、隔離されない。導入するときに利用者へ伝え、確かめてもらう
- 1 つのプラグインが処理に時間を掛けすぎると、全トラックの音が途切れる。FX のダイアログに、音を作る処理の負荷を出す

## 導入

設定の「プラグイン」で、`manifest.json` の URL を入れて追加する。追加したプラグインは端末に保存され、ネットがなくても使える。プロジェクトには id とつまみの値が残る。入っていない端末で開くと、そのエフェクトは素通しになる（値は残る）。

## TypeScript で書く場合

`plugin-sdk/types.ts` に型、`FxBase` に Web Audio のノードを組むプラグインの基底クラスがある（標準のエフェクトはこれで作ってある。`web/src/plugins/` を見本にできる）。

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
node plugin-sdk/scripts/wevocal-plugin.mjs build my-plugin
```

`build` は `dist/` に `manifest.json`（訳文を `lang` に入れたもの）と `processor.js`（と wasm）を出す。配るのはこの中身だけ。

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
| `presets` | 同梱のプリセット（`name` と `values`） |
| `migrate` | 古い `param` の id から新しい id への読み替え |

## processor

- 1 つのファイルにまとめる（`import` は使えない。バンドラーで固める）
- `registerProcessor` する名前は `wevocal-fx-` に id の英数字以外を `-` にしたものを付ける（`my.gain` なら `wevocal-fx-my-gain`）
- つまみは `params` の `id` と同じ名前の `AudioParam`。`parameterDescriptors` に同じ名前で定義する。値は 128 サンプルごと（長さ 1 なら一定）
- `process` の中で確保しない。状態はプラグインの中に持つ
- 重い処理は wasm にして、`process` から 128 サンプルにつき 1 回だけ呼ぶ

## 安全と負荷

- プラグインは、アプリと同じ場所（同じ AudioContext の同じスレッド）で動き、隔離されない。導入するときに利用者へ伝え、確かめてもらう
- 1 つのプラグインが処理に時間を掛けすぎると、全トラックの音が途切れる。FX のダイアログに、音を作る処理の負荷を出す

## 導入

設定の「プラグイン」で、`manifest.json` の URL を入れて追加する。追加したプラグインは端末に保存され、ネットがなくても使える。プロジェクトには id とつまみの値が残る。入っていない端末で開くと、そのエフェクトは素通しになる（値は残る）。

## TypeScript で書く場合

`plugin-sdk/types.ts` に型、`FxBase` に Web Audio のノードを組むプラグインの基底クラスがある（標準のエフェクトはこれで作ってある。`web/src/plugins/` を見本にできる）。

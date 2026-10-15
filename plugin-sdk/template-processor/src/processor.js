// 見本の processor（音量を dB で変えるだけ）。1 つのファイルにまとめる。registerProcessor の名前は 'wevocal-fx-' + id の英数字以外を - にしたもの
class GainProcessor extends AudioWorkletProcessor {
  // つまみは manifest の params の id と同じ名前の AudioParam。128 サンプルごとの値（長さ 1 なら一定）で渡される
  static get parameterDescriptors() {
    return [{ name: 'gain', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'a-rate' }]
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    const gain = parameters.gain
    for (let c = 0; c < output.length; c++) {
      const src = input[c] ?? input[0]
      if (!src) continue
      for (let i = 0; i < output[c].length; i++) {
        const db = gain.length > 1 ? gain[i] : gain[0]
        output[c][i] = src[i] * 10 ** (db / 20)
      }
    }
    return true
  }
}

registerProcessor('wevocal-fx-example-gain', GainProcessor)

// wevocal-lib（TypeScript 側）: WeVocalSynth と WeVocalExtractor で共通に使う、音声ファイルの読み込みと書き出し、再生の開始と停止
export type { Clip, Range } from './types'
export { AUDIO_ACCEPT, decodeFile, readFile, mp4SampleRate } from './decode'
export { encodeWav, downloadWav, downloadBlob, type WavFormat } from './wav'
export { exportAudio, EXPORT_EXT, type ExportFormat, type ExportOptions } from './export/exportAudio'
export { MP3_SAMPLE_RATES, OPUS_SAMPLE_RATE, canEncodeOpus } from './export/formats'
export { startContext, suspendContext, configurePlayback, type PlaybackOptions } from './playback'
export { canSelectOutput, setOutputDevice, listOutputDevices, revealDeviceLabels, type OutputDevice } from './outputDevice'

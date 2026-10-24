/* tslint:disable */
/* eslint-disable */

export class JsVst {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * jitMisses のために数え始める（調査用。数えると遅くなる）
     */
    countJitMisses(): void;
    /**
     * 画面でつまみを変えた分。[index, 値, index, 値, …]
     */
    editorChanges(): Float32Array;
    editorClose(): void;
    /**
     * 今の画面（RGBA。幅と高さは editorOpen で返したもの）
     */
    editorFrame(): Uint8Array | undefined;
    /**
     * 一定時間ごと（30 回ほど毎秒）に呼ぶ
     */
    editorIdle(): void;
    /**
     * マウスの入力。msg は 0x200 移動、0x201 左ボタンを押した、0x202 離した、0x203 ダブルクリック。keys は bit0 左ボタン、bit1 Ctrl、bit2 Shift
     */
    editorMouse(msg: number, x: number, y: number, keys: number): void;
    /**
     * 画面を開く。[幅, 高さ]
     */
    editorOpen(): Int32Array;
    getParam(index: number): number;
    /**
     * 画面を持つか
     */
    hasEditor(): boolean;
    /**
     * JIT で実行した命令の割合（調査用。0..1）
     */
    jitCoverage(): number;
    /**
     * JIT が有効なのにインタープリターで動かしたブロックの先頭の命令（多い順に "回数 命令" の行。調査用。先に countJitMisses）
     */
    jitMisses(): string;
    /**
     * 変換した関数の数、変換にかかった時間、生成した wasm の合計、JIT の関数を呼んだ回数、JIT で動いた命令の数（"数 ms バイト 回数 命令数"。調査用）
     */
    jitStats(): string;
    name(): string;
    /**
     * DLL のバイト列から読み込む（32 ビットも 64 ビットも）
     */
    constructor(dll: Uint8Array);
    /**
     * つまみ index の名前
     */
    paramName(index: number): string;
    /**
     * 入力（チャンネルごとの Float32Array を並べた配列）を通し、出力（同じ形）を返す
     */
    process(input: Float32Array[], frames: number): Float32Array[];
    /**
     * MIDI のメッセージ（status、data1、data2）を送る。次の process のブロックの頭から delta サンプル目に効く
     */
    sendMidi(status: number, data1: number, data2: number, delta: number): void;
    /**
     * JIT で変換しない命令の名前（カンマ区切り、小文字。例 "bts,imul"。JIT の不具合を命令の種類で切り分けるため。調査用）
     */
    setJitDeny(names: string): void;
    /**
     * 変換を始める実行回数（既定 8。調査用）
     */
    setJitThreshold(n: number): void;
    /**
     * JIT を使うか（ありとなしで出力を比べるため。既定は使う）
     */
    setJit(on: boolean): void;
    setParam(index: number, value: number): void;
    /**
     * 32 ビットの DLL か
     */
    readonly is32bit: boolean;
    readonly numInputs: number;
    readonly numOutputs: number;
    readonly numParams: number;
}

/**
 * JIT のつなぎ方の確かめ（引数に 42 を足して返す）
 */
export function jitSelftest(x: number): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_jsvst_free: (a: number, b: number) => void;
    readonly jitSelftest: (a: number) => [number, number, number];
    readonly jsvst_countJitMisses: (a: number) => void;
    readonly jsvst_editorChanges: (a: number) => [number, number];
    readonly jsvst_editorClose: (a: number) => [number, number];
    readonly jsvst_editorFrame: (a: number) => [number, number];
    readonly jsvst_editorIdle: (a: number) => [number, number];
    readonly jsvst_editorMouse: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly jsvst_editorOpen: (a: number) => [number, number, number, number];
    readonly jsvst_getParam: (a: number, b: number) => [number, number, number];
    readonly jsvst_hasEditor: (a: number) => number;
    readonly jsvst_is32bit: (a: number) => number;
    readonly jsvst_jitCoverage: (a: number) => number;
    readonly jsvst_jitMisses: (a: number) => [number, number];
    readonly jsvst_jitStats: (a: number) => [number, number];
    readonly jsvst_name: (a: number) => [number, number, number, number];
    readonly jsvst_new: (a: number, b: number) => [number, number, number];
    readonly jsvst_numInputs: (a: number) => number;
    readonly jsvst_numOutputs: (a: number) => number;
    readonly jsvst_numParams: (a: number) => number;
    readonly jsvst_paramName: (a: number, b: number) => [number, number, number, number];
    readonly jsvst_process: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly jsvst_sendMidi: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly jsvst_setJit: (a: number, b: number) => void;
    readonly jsvst_setJitDeny: (a: number, b: number, c: number) => void;
    readonly jsvst_setJitThreshold: (a: number, b: number) => void;
    readonly jsvst_setParam: (a: number, b: number, c: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export: WebAssembly.Table;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

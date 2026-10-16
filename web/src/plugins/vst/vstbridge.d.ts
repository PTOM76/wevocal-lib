/* tslint:disable */
/* eslint-disable */

export class JsVst {
    free(): void;
    [Symbol.dispose](): void;
    getParam(index: number): number;
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
    setParam(index: number, value: number): void;
    /**
     * 32 ビットの DLL か
     */
    readonly is32bit: boolean;
    readonly numInputs: number;
    readonly numOutputs: number;
    readonly numParams: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_jsvst_free: (a: number, b: number) => void;
    readonly jsvst_getParam: (a: number, b: number) => [number, number, number];
    readonly jsvst_is32bit: (a: number) => number;
    readonly jsvst_name: (a: number) => [number, number, number, number];
    readonly jsvst_new: (a: number, b: number) => [number, number, number];
    readonly jsvst_numInputs: (a: number) => number;
    readonly jsvst_numOutputs: (a: number) => number;
    readonly jsvst_numParams: (a: number) => number;
    readonly jsvst_paramName: (a: number, b: number) => [number, number, number, number];
    readonly jsvst_process: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly jsvst_setParam: (a: number, b: number, c: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_alloc: () => number;
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

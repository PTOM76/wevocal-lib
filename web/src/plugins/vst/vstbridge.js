/* @ts-self-types="./vstbridge.d.ts" */

export class JsVst {
    static __wrap(ptr) {
        const obj = Object.create(JsVst.prototype);
        obj.__wbg_ptr = ptr;
        JsVstFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        JsVstFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_jsvst_free(ptr, 0);
    }
    /**
     * wasm のメモリの写しから戻したあとに呼ぶ。変換した関数（JIT）は元の wasm の関数の表にあり、戻した先には無いので捨てる（使うとまた変換する）。
     * 写しは、読み込みの済んだ JsVst があるメモリを、JS から何も呼んでいない間にまるごと写したもの（同じ wasm に限る）
     */
    afterRestore() {
        wasm.jsvst_afterRestore(this.__wbg_ptr);
    }
    /**
     * jitMisses のために数え始める（調査用。数えると遅くなる）
     */
    countJitMisses() {
        wasm.jsvst_countJitMisses(this.__wbg_ptr);
    }
    /**
     * 画面でつまみを変えた分。[index, 値, index, 値, …]
     * @returns {Float32Array}
     */
    editorChanges() {
        const ret = wasm.jsvst_editorChanges(this.__wbg_ptr);
        var v1 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    editorClose() {
        const ret = wasm.jsvst_editorClose(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * 今の画面（RGBA。幅と高さは editorOpen で返したもの）
     * @returns {Uint8Array | undefined}
     */
    editorFrame() {
        const ret = wasm.jsvst_editorFrame(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * 一定時間ごと（30 回ほど毎秒）に呼ぶ
     */
    editorIdle() {
        const ret = wasm.jsvst_editorIdle(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * マウスの入力。msg は 0x200 移動、0x201 左ボタンを押した、0x202 離した、0x203 ダブルクリック。keys は bit0 左ボタン、bit1 Ctrl、bit2 Shift
     * @param {number} msg
     * @param {number} x
     * @param {number} y
     * @param {number} keys
     */
    editorMouse(msg, x, y, keys) {
        const ret = wasm.jsvst_editorMouse(this.__wbg_ptr, msg, x, y, keys);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * 画面を開く。[幅, 高さ]
     * @returns {Int32Array}
     */
    editorOpen() {
        const ret = wasm.jsvst_editorOpen(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayI32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {number} index
     * @returns {number}
     */
    getParam(index) {
        const ret = wasm.jsvst_getParam(this.__wbg_ptr, index);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * 画面を持つか
     * @returns {boolean}
     */
    hasEditor() {
        const ret = wasm.jsvst_hasEditor(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * 32 ビットの DLL か
     * @returns {boolean}
     */
    get is32bit() {
        const ret = wasm.jsvst_is32bit(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * JIT で実行した命令の割合（調査用。0..1）
     * @returns {number}
     */
    jitCoverage() {
        const ret = wasm.jsvst_jitCoverage(this.__wbg_ptr);
        return ret;
    }
    /**
     * JIT が有効なのにインタープリターで動かしたブロックの先頭の命令（多い順に "回数 命令" の行。調査用。先に countJitMisses）
     * @returns {string}
     */
    jitMisses() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.jsvst_jitMisses(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * 変換した関数の数、変換にかかった時間、生成した wasm の合計、JIT の関数を呼んだ回数、JIT で動いた命令の数（"数 ms バイト 回数 命令数"。調査用）
     * @returns {string}
     */
    jitStats() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.jsvst_jitStats(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    name() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.jsvst_name(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * DLL のバイト列から読み込む（32 ビットも 64 ビットも）
     * @param {Uint8Array} dll
     */
    constructor(dll) {
        const ptr0 = passArray8ToWasm0(dll, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.jsvst_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        JsVstFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    get numInputs() {
        const ret = wasm.jsvst_numInputs(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get numOutputs() {
        const ret = wasm.jsvst_numOutputs(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get numParams() {
        const ret = wasm.jsvst_numParams(this.__wbg_ptr);
        return ret;
    }
    /**
     * つまみ index の名前
     * @param {number} index
     * @returns {string}
     */
    paramName(index) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.jsvst_paramName(this.__wbg_ptr, index);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * 入力（チャンネルごとの Float32Array を並べた配列）を通し、出力（同じ形）を返す
     * @param {Float32Array[]} input
     * @param {number} frames
     * @returns {Float32Array[]}
     */
    process(input, frames) {
        const ptr0 = passArrayJsValueToWasm0(input, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.jsvst_process(this.__wbg_ptr, ptr0, len0, frames);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * MIDI のメッセージ（status、data1、data2）を送る。次の process のブロックの頭から delta サンプル目に効く
     * @param {number} status
     * @param {number} data1
     * @param {number} data2
     * @param {number} delta
     */
    sendMidi(status, data1, data2, delta) {
        const ret = wasm.jsvst_sendMidi(this.__wbg_ptr, status, data1, data2, delta);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * JIT で変換しない命令の名前（カンマ区切り、小文字。例 "bts,imul"。JIT の不具合を命令の種類で切り分けるため。調査用）
     * @param {string} names
     */
    setJitDeny(names) {
        const ptr0 = passStringToWasm0(names, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.jsvst_setJitDeny(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * 変換を始める実行回数（既定 8。調査用）
     * @param {number} n
     */
    setJitThreshold(n) {
        wasm.jsvst_setJitThreshold(this.__wbg_ptr, n);
    }
    /**
     * JIT を使うか（ありとなしで出力を比べるため。既定は使う）
     * @param {boolean} on
     */
    setJit(on) {
        wasm.jsvst_setJit(this.__wbg_ptr, on);
    }
    /**
     * @param {number} index
     * @param {number} value
     */
    setParam(index, value) {
        const ret = wasm.jsvst_setParam(this.__wbg_ptr, index, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) JsVst.prototype[Symbol.dispose] = JsVst.prototype.free;

/**
 * DLL の読み込みを少しずつ進める（AudioWorklet の中で、音のスレッドを長く止めないため）。
 * new で置いたあと、step を終わる（true）まで呼び、finish で JsVst にする
 */
export class JsVstLoader {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        JsVstLoaderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_jsvstloader_free(ptr, 0);
    }
    /**
     * 読み込みが終わったものを JsVst にする（この loader は使えなくなる）
     * @returns {JsVst}
     */
    finish() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.jsvstloader_finish(ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return JsVst.__wrap(ret[0]);
    }
    /**
     * DLL を置き、import をつなぐ（命令はまだ動かさない）
     * @param {Uint8Array} dll
     */
    constructor(dll) {
        const ptr0 = passArray8ToWasm0(dll, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.jsvstloader_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        JsVstLoaderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * 命令を最大 budget 個動かして読み込みを進める。終わったら true
     * @param {number} budget
     * @returns {boolean}
     */
    step(budget) {
        const ret = wasm.jsvstloader_step(this.__wbg_ptr, budget);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
}
if (Symbol.dispose) JsVstLoader.prototype[Symbol.dispose] = JsVstLoader.prototype.free;

/**
 * JIT のつなぎ方の確かめ（引数に 42 を足して返す）
 * @param {number} x
 * @returns {number}
 */
export function jitSelftest(x) {
    const ret = wasm.jitSelftest(x);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_30c8987f7c2ed4e2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_debug_string_4687d8d8c2017d52: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_function_table_639dd63419065a39: function() {
            const ret = wasm.__wbindgen_export;
            return ret;
        },
        __wbg___wbindgen_memory_caa4a6165639c8b5: function() {
            const ret = wasm.memory;
            return ret;
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_exports_01489638e7199ac6: function(arg0) {
            const ret = arg0.exports;
            return ret;
        },
        __wbg_get_31af05bd4842a84f: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_grow_1fb133f54188ea88: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.grow(arg1 >>> 0);
            return ret;
        }, arguments); },
        __wbg_length_58572db4c38f3c3e: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_3e09b06cb26fb67d: function() { return handleError(function (arg0) {
            const ret = new WebAssembly.Module(arg0);
            return ret;
        }, arguments); },
        __wbg_new_617a8cdb8bb1130e: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_d8e1e47df3827d47: function() { return handleError(function (arg0, arg1) {
            const ret = new WebAssembly.Instance(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_new_from_slice_9a868026ffa4208a: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_ca6ad97db1f4779a: function(arg0, arg1) {
            const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_now_aa4ccb83129e9e55: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_prototypesetcall_8b03c01e2c0f8066: function(arg0, arg1, arg2) {
            Float32Array.prototype.set.call(getArrayF32FromWasm0(arg0, arg1), arg2);
        },
        __wbg_set_145a351398b48c65: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_4b165309ba769a9b: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.set(arg1 >>> 0, arg2);
        }, arguments); },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./vstbridge_bg.js": import0,
    };
}

const JsVstFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_jsvst_free(ptr, 1));
const JsVstLoaderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_jsvstloader_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayI32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getInt32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedInt32ArrayMemory0 = null;
function getInt32ArrayMemory0() {
    if (cachedInt32ArrayMemory0 === null || cachedInt32ArrayMemory0.byteLength === 0) {
        cachedInt32ArrayMemory0 = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedInt32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('vstbridge_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };

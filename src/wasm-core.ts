// Rust core (wasm/), compiled to wasm32 and inlined into main.js by esbuild's
// binary loader: Obsidian installs only main.js/manifest.json/styles.css, so a
// sidecar .wasm file would never reach users. Optional by design: until
// loadWasmCore() resolves, or if it rejects (no WebAssembly, a CSP without
// 'wasm-unsafe-eval', a corrupt build), every caller stays on its JS path.
import bundledWasm from "../wasm/engram_core.wasm";

interface Exports {
	memory: WebAssembly.Memory;
	buf_ptr(): number;
	out_ptr(): number;
	fnv1a_b64(h: number, len: number): number;
	b64_encode(len: number): number;
}

export interface WasmCore {
	/** Same value as fnv1aBase64Js. */
	fnv1aBase64(buffer: ArrayBuffer): number;
	/** Same string as arrayBufferToBase64Js. */
	base64(buffer: ArrayBuffer): string;
}

// Must match BUF_LEN in wasm/src/lib.rs. A multiple of 3, so both the hash and
// the encoding resume across windows with no inner padding.
const WIN = 3 * 16 * 1024;

let core: WasmCore | undefined;

export function wasmCore(): WasmCore | undefined {
	return core;
}

/** Test seam: back to the JS paths. */
export function resetWasmCore(): void {
	core = undefined;
}

/** Instantiate the core and return the time it took (ms). Async on purpose:
 *  Chromium refuses synchronous compiles of modules over 4 KB on the main
 *  thread, and this keeps that limit irrelevant as the core grows. Rejects
 *  (leaving the JS paths in charge) if the module fails to compile or fails
 *  its known-answer self-check. */
export async function loadWasmCore(bytes: Uint8Array = bundledWasm): Promise<number> {
	const t0 = performance.now();
	const { instance } = await WebAssembly.instantiate(bytes);
	const ex = instance.exports as unknown as Exports;
	// memory never grows (no allocator in the core), so these views stay valid.
	const input = new Uint8Array(ex.memory.buffer, ex.buf_ptr(), WIN);
	const output = new Uint8Array(ex.memory.buffer, ex.out_ptr(), (WIN / 3) * 4);
	// Base64 is ASCII, so UTF-8 decodes it exactly, and V8's UTF-8 ASCII fast
	// path is ~17x quicker than its latin1 decoder (node 22).
	const ascii = new TextDecoder();

	const candidate: WasmCore = {
		fnv1aBase64(buffer) {
			const b = new Uint8Array(buffer);
			let h = 0x811c9dc5;
			for (let i = 0; i < b.length; i += WIN) {
				const chunk = b.subarray(i, i + WIN);
				input.set(chunk);
				h = ex.fnv1a_b64(h, chunk.length);
			}
			return h >>> 0;
		},
		base64(buffer) {
			const b = new Uint8Array(buffer);
			const parts: string[] = [];
			for (let i = 0; i < b.length; i += WIN) {
				const chunk = b.subarray(i, i + WIN);
				input.set(chunk);
				parts.push(ascii.decode(output.subarray(0, ex.b64_encode(chunk.length))));
			}
			return parts.join("");
		},
	};
	// Known answers: "hello" -> "aGVsbG8=", and fnv1a("aGVsbG8=").
	const hello = new TextEncoder().encode("hello").buffer;
	if (candidate.base64(hello) !== "aGVsbG8=" || candidate.fnv1aBase64(hello) !== 0x9c39cc4e) {
		throw new Error("wasm core failed its self-check");
	}
	core = candidate;
	return performance.now() - t0;
}

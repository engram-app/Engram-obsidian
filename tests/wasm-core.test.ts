import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { arrayBufferToBase64, arrayBufferToBase64Js } from "../src/api";
import { fnv1a, fnv1aBase64, fnv1aBase64Js } from "../src/content-hash";
import { loadWasmCore, resetWasmCore, wasmCore } from "../src/wasm-core";

// Every implementation of the attachment hash and of base64 encode must agree
// byte for byte with an independent oracle (node's Buffer): a hash that drifts
// makes every attachment look locally modified and re-upload.
const oracle = (b: Uint8Array) =>
	Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("base64");

function random(n: number): Uint8Array {
	const out = new Uint8Array(n);
	for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, i + 65536));
	return out;
}

const inputs: [string, Uint8Array][] = [
	["empty", new Uint8Array(0)],
	["all 256 byte values", Uint8Array.from({ length: 256 }, (_, i) => i)],
	// One past a 48 KiB window boundary, so chunking must resume mid-stream.
	["window + 1", random(3 * 16 * 1024 + 1)],
	["1 MB random", random(1 << 20)],
	["10 MB random", random(10 << 20)],
];
for (let n = 1; n <= 8; n++) {
	inputs.push([`padding len ${n}`, new Uint8Array(n).map((_, i) => 250 - i * 31)]);
}

beforeAll(async () => {
	await loadWasmCore();
});
afterAll(() => resetWasmCore());

describe("wasm core loads", () => {
	test("instantiates from the bundled bytes", () => {
		expect(wasmCore()).toBeDefined();
	});
});

for (const [impl, hash] of [
	["js", fnv1aBase64Js],
	["wasm", (b: ArrayBuffer) => wasmCore()!.fnv1aBase64(b)],
	["dispatch", fnv1aBase64],
] as const) {
	describe(`fnv1aBase64 (${impl})`, () => {
		for (const [name, bytes] of inputs) {
			test(name, () => {
				expect(hash(bytes.buffer as ArrayBuffer)).toBe(fnv1a(oracle(bytes)));
			});
		}
	});
}

for (const [impl, encode] of [
	["js", arrayBufferToBase64Js],
	["wasm", (b: ArrayBuffer) => wasmCore()!.base64(b)],
	["dispatch", arrayBufferToBase64],
] as const) {
	describe(`arrayBufferToBase64 (${impl})`, () => {
		for (const [name, bytes] of inputs) {
			test(name, () => {
				expect(encode(bytes.buffer as ArrayBuffer)).toBe(oracle(bytes));
			});
		}
	});
}

describe("fallback", () => {
	test("bad bytes reject and leave the JS path in charge", async () => {
		resetWasmCore();
		await expect(loadWasmCore(new Uint8Array([0, 97, 115, 109]))).rejects.toThrow();
		expect(wasmCore()).toBeUndefined();
		const b = Uint8Array.from([1, 2, 3, 4]);
		expect(fnv1aBase64(b.buffer)).toBe(fnv1a(oracle(b)));
		expect(arrayBufferToBase64(b.buffer)).toBe(oracle(b));
		await loadWasmCore();
	});
});

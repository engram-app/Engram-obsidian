// Before/after bench for the attachment hash and base64 encode, min of 5 runs:
//   bun --preload ./wasm/bun-plugin.ts wasm/bench.ts
//   node --import ./wasm/node-hooks.mjs wasm/bench.ts   (Node 22.18+, V8)
import { fnv1aBase64Js } from "../src/content-hash";
import { loadWasmCore, wasmCore } from "../src/wasm-core";

// Copy of arrayBufferToBase64Js: src/api.ts imports "obsidian", which only
// exists inside the app.
function toBase64Js(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const parts: string[] = [];
	for (let i = 0; i < bytes.length; i += 0x8000) {
		parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
	}
	return btoa(parts.join(""));
}

const loadMs = await loadWasmCore();
const core = wasmCore()!;
const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
console.log(`${runtime}  wasm load ${loadMs.toFixed(2)} ms`);
for (const mb of [1, 10]) {
	const data = new Uint8Array(mb * 1024 * 1024);
	for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) >>> 24;
	const buf = data.buffer;
	if (core.fnv1aBase64(buf) !== fnv1aBase64Js(buf)) throw new Error("hash parity");
	if (core.base64(buf) !== toBase64Js(buf)) throw new Error("base64 parity");
	const cases: [string, () => unknown][] = [
		["ts fnv1aBase64", () => fnv1aBase64Js(buf)],
		["wasm fnv1a_b64", () => core.fnv1aBase64(buf)],
		["ts arrayBufferToBase64", () => toBase64Js(buf)],
		["wasm b64_encode", () => core.base64(buf)],
	];
	const native = (data as { toBase64?: () => string }).toBase64;
	if (native) cases.push(["native toBase64", () => native.call(data)]);
	for (const [name, fn] of cases) {
		for (let w = 0; w < 3; w++) fn(); // warm the JIT tiers
		let wall = Infinity;
		let cpu = Infinity;
		let heap = 0;
		for (let r = 0; r < 5; r++) {
			const h0 = process.memoryUsage().heapUsed;
			const c0 = process.cpuUsage();
			const t0 = performance.now();
			fn();
			wall = Math.min(wall, performance.now() - t0);
			const c = process.cpuUsage(c0);
			cpu = Math.min(cpu, (c.user + c.system) / 1000);
			heap = Math.max(heap, process.memoryUsage().heapUsed - h0);
		}
		console.log(
			`${mb} MB  ${name.padEnd(24)} wall ${wall.toFixed(2)} ms  cpu ${cpu.toFixed(2)} ms  heap +${(heap / 1048576).toFixed(2)} MB`,
		);
	}
}

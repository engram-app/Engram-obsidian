// `node --import ./wasm/node-hooks.mjs wasm/bench.ts`: lets plain Node run the
// plugin's real src/ modules for the V8 numbers. Mirrors what esbuild does:
// extensionless relative imports resolve to .ts, and a .wasm import is bytes.
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(import.meta.url);

export async function resolve(specifier, context, next) {
	if (specifier.startsWith(".") && !/\.[cm]?[jt]s$|\.wasm$/.test(specifier)) {
		return next(`${specifier}.ts`, context);
	}
	return next(specifier, context);
}

export async function load(url, context, next) {
	if (!url.endsWith(".wasm")) return next(url, context);
	const b64 = readFileSync(new URL(url)).toString("base64");
	return {
		format: "module",
		shortCircuit: true,
		source: `export default Uint8Array.from(atob("${b64}"), (c) => c.charCodeAt(0));`,
	};
}

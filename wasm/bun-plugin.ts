// Mirror esbuild's `.wasm: binary` loader (esbuild.config.mjs) in bun: a .wasm
// import is the module's bytes, where bun's default hands back a file path.
// Preloaded by tests/preload.ts; `bun --preload ./wasm/bun-plugin.ts` elsewhere.
import { readFileSync } from "node:fs";

Bun.plugin({
	name: "wasm-as-bytes",
	setup(build) {
		build.onLoad({ filter: /\.wasm$/ }, ({ path }) => ({
			exports: { default: new Uint8Array(readFileSync(path)) },
			loader: "object",
		}));
	},
});

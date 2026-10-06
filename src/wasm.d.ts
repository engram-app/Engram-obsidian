// esbuild's binary loader (esbuild.config.mjs) turns a .wasm import into bytes.
declare module "*.wasm" {
	const bytes: Uint8Array;
	export default bytes;
}

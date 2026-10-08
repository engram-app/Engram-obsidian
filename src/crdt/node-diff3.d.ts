// node-diff3 ships types behind package "exports", which moduleResolution
// "node" cannot see; point TypeScript at them (types only, no runtime effect).
declare module "node-diff3" {
	export * from "node-diff3/src/diff3";
}

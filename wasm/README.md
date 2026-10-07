# engram-core (wasm)

Pure-Rust core compiled to `wasm32-unknown-unknown` and inlined into `main.js`.
Today: the attachment sync hash (`fnv1a_base64`) and base64 encode.

## Layout

- `src/lib.rs`: the core. Plain functions over byte slices; no I/O, no
  allocation, no wasm or rustler types.
- `src/wasm_abi.rs`: the only wasm-specific code. A plain `extern "C"` ABI (no
  wasm-bindgen, so no JS glue): JS copies input into a fixed 48 KiB window
  (`buf_ptr`) and gets a number back; base64 lands in a 64 KiB output window
  (`out_ptr`). Fixed windows mean linear memory never grows: 2 pages (128 KiB)
  per instance, and the JS views never detach.
- `engram_core.wasm`: the built artifact, **committed** (see Build).
- `bench.ts`: before/after bench, `bun wasm/bench.ts` or `node wasm/bench.ts`.

## Build

```bash
bun run build:wasm   # scripts/build-wasm.sh, toolchain pinned by rust-toolchain.toml
```

The artifact is committed because several builders run `bun run build` with no
Rust: the backend e2e suite (builds the plugin from source), `pr-build.yml` and
`release-please.yml`. The `wasm core` job in `lint.yml` runs fmt, clippy (host
and wasm32), `cargo test`, then rebuilds and fails if the committed bytes
differ. The build is byte-reproducible across checkout paths (no debug info,
no panic strings). `wasm-opt` is not used: binaryen is not installed here and
would also need pinning to stay reproducible; at ~1 KB there is little to win.

## Runtime

`src/wasm-core.ts` instantiates asynchronously at plugin load (Chromium refuses
sync compiles over 4 KB on the main thread), runs a known-answer self-check,
and only then switches callers over. If WebAssembly is missing, a CSP blocks
it, or the self-check fails, it logs once and every caller stays on JS.

## Plan

The shared core moves to the backend repo as `native/engram_core`, consumed by
the rustler NIF (`native/engram_native`), this plugin and the web app. Moving it
is mechanical: `lib.rs` is the core, `wasm_abi.rs` stays a thin wasm32 layer,
and the toolchain pin (1.94.1) already matches `engram_native`. Candidates to
share next, so all three clients agree byte for byte: frontmatter split, note
title/tags, link extraction and the single-span text diff, all already pure
modules in `engram_native`.

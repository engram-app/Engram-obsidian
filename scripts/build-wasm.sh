#!/usr/bin/env bash
# Rebuild wasm/engram_core.wasm from wasm/src. The .wasm is COMMITTED: the
# backend e2e suite and the release workflows build this plugin with bun only,
# so `bun run build` must not need Rust. CI (lint.yml wasm-core) reruns this
# and fails if the committed bytes differ from a fresh build.
set -euo pipefail
cd "$(dirname "$0")/../wasm"
cargo build --release --target wasm32-unknown-unknown --locked
out=target/wasm32-unknown-unknown/release/engram_core.wasm
cp "$out" engram_core.wasm
echo "wasm/engram_core.wasm: $(wc -c <engram_core.wasm) bytes"

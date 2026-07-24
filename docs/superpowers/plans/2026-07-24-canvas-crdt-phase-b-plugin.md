# Plan: #306 Phase B (plugin) — canvas onto the CRDT path

**Date:** 2026-07-24
**Repo:** engram-obsidian (worktree `feat/canvas-crdt-plugin`)
**Pairs with:** backend PR #1107 (must merge first). Spec: Engram vault `50 Engineering/_Superpowers Specs/2026-07-23-canvas-crdt-sync-design.md`.
**Goal:** Route `.canvas` notes through the same Yjs CRDT transport `.md` uses, with a *structural* doc schema (per-element merge), so canvas leaves the legacy REST/LWW + conflict tail. Unblocks Phase C (delete three-way-merge/diff/conflict-modal).

## Design decisions

1. **Structural schema (approved, do not relitigate).** Canvas doc = `Y.Map "nodes"` (keyed by node id) + `Y.Map "edges"` (keyed by edge id) + `Y.Map "canvas_meta"` (top-level non-node/edge fields) + `Y.Array "nodes_order"` + `Y.Array "edges_order"` (preserve array order == z-index; mirrors the existing `frontmatter_order` pattern). Order arrays are NOT in the one-liner spec but are required for project∘reconcile identity and stable disk hashes; they merge like `frontmatter_order`.
2. **Manager learns doc kind once, stores it on the entry.** `manager.ts` has zero type-awareness today (keyed by bare noteId). Thread a `kind: "note" | "canvas"` into the doc-creating entry point; store on the `entry()` value. The two `doc.on("update")` listeners and the projection method branch on `e.kind` (markdown→`projectNote`, canvas→`projectCanvas`). Default `"note"` keeps every existing caller unchanged. Kind derived from file extension at the sync.ts call sites.
3. **Reuse, don't fork, the transport + drift path.** Canvas rides `crdt_create`/`crdt_msg`/`crdt_delete`/`crdt_catchup` unchanged. Canvas divergence routes through the SAME `writeDriftConflictCopy` + `socketConverge` the md `localDiverged` branch uses (generalize the helper's hardcoded `.md` suffix).
4. **JSON fidelity.** Obsidian writes `.canvas` as `JSON.stringify(data, null, "\t")` (tabs). `projectCanvas` must match byte-for-byte or every pull re-hashes/re-writes. Confirm the exact format from an Obsidian-written canvas before finalizing.

## Stages (TDD, RED-first each; one concern per commit)

### Stage 1 — manager canvas schema (pure, unit-tested in isolation)
- Add `canvas-codec.ts` (or functions in `manager.ts`): `seedCanvasInto(doc, jsonStr)` and `projectCanvas(doc)`.
  - `seedCanvasInto`: parse JSON; upsert changed nodes/edges by id into the Y.Maps; delete removed ids; replace order arrays; canvas_meta for leftover top-level keys. One `doc.transact`.
  - `projectCanvas`: rebuild `{...canvas_meta, nodes:[order→node], edges:[order→edge]}` → `JSON.stringify(_, null, "\t")`.
- **RED test** (mirror `manager.test.ts:409` round-trip): `projectCanvas(seedCanvasInto(doc, json)) === json` (identity); concurrent per-element merge (two docs edit different nodes → both survive); node delete propagates; malformed JSON → no throw (keep-local fallback signalled).

### Stage 2 — manager kind-threading
- Thread `kind` into `entry()`/`getDoc`/`applyLocalEdit`/`projectedText`/`encodeGenesisUpdate`; store on entry; branch the two update listeners + `projectedText` on `e.kind`. `applyLocalEdit` for a canvas doc calls `seedCanvasInto` instead of `seedContentInto`; the flush listener projects via `projectCanvas`.
- **RED test**: `applyLocalEdit(id, canvasJson, "canvas")` populates nodes/edges maps (not the content Y.Text); a remote update flushes canvas JSON to disk via the listener.

### Stage 3 — sync.ts push (canvas → crdt_create / crdt_msg)
- Generalize the `file.extension === "md"` push gates (`:2466/2498/2587/2610/2800`) + `routeModify` `isMarkdown` params to admit canvas (pass `kind`). Canvas reaches genesis `crdt_create` / `routeModify`→`applyLocalEdit`(canvas) / durable `crdtEnqueue create` instead of `api.pushNote` `:2814`.
- `routeModify` `:92` gate: `isMarkdown` → `isCrdtEligible` (md OR canvas); keep the byte cap (canvas can be large — same 4MiB cap; oversized canvas falls back to REST push, which survives).
- `handleModify` `crdtManaged` `:1968` + live-bound skip `:1982`: include canvas.
- **RED test**: update `sync-crdt-route.test.ts:399` (was ".canvas uses legacy pushNote") to assert canvas now routes through `applyLocalEdit`/crdt_create; canvas enroll test `sync-crdt-gate.test.ts:320`.

### Stage 4 — sync.ts delete + rename (canvas → crdt_delete / rename-as-move)
- Delete `:2067/2081`: canvas → `crdtEnqueue {kind:"delete"}`, drop `api.deleteNote`. Teardown gates `:2056/2089/2097/4457/5262`: include canvas so `removeDoc` runs.
- Rename `:2140/2153`: canvas → md no-tombstone rename-as-move (drop old-path `api.deleteNote`).
- Offline queue delete `:7335`: verify canvas delete rides crdt.
- **RED test**: canvas delete enqueues crdt delete + tears down doc; canvas rename moves without REST tombstone.

### Stage 5 — sync.ts pull (canvas enters crdtOwnsBody block)
- `crdtOwnsBody` `:5285`: `.md` → md-or-canvas. Canvas now enters the CRDT pull-apply block (`:5333-5679`) and skips the legacy REST/LWW + conflict tail `:5681+`. Anti-stale guard `:5309`.
- Flush/materialize gates `:838/1010/1414/1449/4487`: include canvas.
- Drift: generalize `writeDriftConflictCopy` `:1381` (`.md$` → the real ext); route canvas `localDiverged` `:5544` through the same drift-copy + `socketConverge`.
- **RED test**: canvas remote upsert applies via CRDT (no ConflictModal); canvas external-disk-drift writes a `(conflict …).canvas` copy + converges.

### Stage 6 — migration + full-suite + biome/lints
- Confirm existing-canvas migration (REST/LWW row, no Yjs state): first open seeds the room from the local `.canvas` file; two-device seed converges by node-id (empty-doc guard #1043/#1094). Add/adjust a sim or route test.
- `bun test` full suite green; fix the legacy canvas tests that pinned REST behavior; `biome ci`, `lint:obsidian`, `lint:css`, `bun run build` (tsc). NO version bump (release-please owns it).

## Verification / merge
- Full `bun test` + biome + build green locally.
- code-reviewer agent, all findings fixed in-PR.
- Paired e2e: backend #1107 merges FIRST, then push plugin branch, re-trigger the engram-side `plugin-e2e-trigger`, and verify the `e2e-crdt` + `e2e-clerk` JOB conclusions green directly (roll-up flakes).
- One PR (one initiative). Refs #306.

## Risks / open
- Canvas JSON format fidelity (tabs vs spaces, key order) — verify against a real Obsidian canvas.
- Node/edge array order under concurrent reorder — order arrays give a deterministic merge, not necessarily the user's intended z-order on a true concurrent reorder (acceptable for Phase 1 file-sync).
- Large-canvas cap: oversized canvas still falls to REST push (`api.pushNote` survives) — the drift-copy/pull path must tolerate a canvas that is REST on one device, CRDT on another during rollout.

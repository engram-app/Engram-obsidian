# Context Doc: CRDT editor-binding race — cross-file pollution with a CLEAN noteIdMap

_Last verified: 2026-07-07_

## Status
Fixed (PR #194, v1.11.21)

## What This Is
Root-cause record of a cross-file content-pollution bug in the CRDT live-editor binding (`src/crdt/live/editor-controller.ts`): switching files in Obsidian copied one note's full content into another, server-side, with a proven-clean noteIdMap (jq bijection check). Distinct from the round-1 wrong-mint/cross-wire map class (see the workspace doc `../engram-workspace/docs/context/crdt-wrong-mint-cross-file-overwrite.md`, PR #193).

## Mechanism
`EditorController.bindTo(view, newPath)` awaited `getYText(newPath)` with the OLD note's ySync binding still attached to the reused CM6 EditorView. Obsidian reuses editor views across note switches; during the await gap, Obsidian's `loadFileInternal`/`setViewData` replaces the entire editor document with the NEW file's content. The still-attached old ySync treats that as a local edit and applies it to the OLD note's Y.Text, which syncs up as that note's content.

- One file switch = one race window.
- Content arrives as a clean full copy (it's a whole-doc replace).
- The 3s drift-repair had the same hole: it dispatched repairs without verifying the view still displayed the bound path — a missed/late rebind repainted the old note's content into the visible file every 3s ("note keeps reverting" symptom).

## Why the Old Code Looked Safe
It deliberately deferred releasing the old binding until after `getYText` resolved, so a failed rebind left the old binding intact. That invariant WAS the bug: a stale-bound gap is data loss; an unbound gap is merely no-live-sync-until-next-refresh. PR #194 flips it.

## Fix (PR #194, v1.11.21) — Relay's never-span-a-load semantics
Reference implementation: relay/Relay/src/main.ts ~1355-1505 (`__relayLoading` critical section + `view.file` identity checks).

1. `bindTo` detaches the old binding SYNCHRONOUSLY (compartment cleared + refcount released) before any await.
2. `bindEpoch` monotonic counter: overlapping `bindTo` calls — latest wins; a slow stale bind aborts after its await.
3. `runDriftCheck` view-identity guard: new optional `ControllerDeps.viewPath()` dep (live-views wires it as `() => getMarkdownFilePath(view)` — the MdView is stable per cm, the file it shows is not). If `viewPath() !== bound path`: detach (NOT release — release marks the controller permanently inert while it stays in live-views' controllers map, which would brick rebinding) and let `refresh()` re-bind.

## Gotchas
- **Testing**: the plugin test harness is fake-view + real Y.Doc, no DOM — real ySync integration can't run, so tests pin the structural invariants instead (sync-detach-before-await via deferred `getYText`, latest-wins via out-of-order resolution, drift guard via injectable `driftIntervalMs`). Tests in `tests/crdt-editor-controller.test.ts`.
- **Detach vs release**: in the drift guard, `release` is wrong — it marks the controller permanently inert while it stays in live-views' controllers map, bricking rebinding. Detach and let `refresh()` re-bind.

## General Lesson
Any binding between a reused editor surface and per-document state must be torn down synchronously at the switch boundary; never trust the editor buffer while a file load is in flight.

## References
- `src/crdt/live/editor-controller.ts` — the fixed code
- `tests/crdt-editor-controller.test.ts` — structural-invariant tests
- Plugin PR #194 (fix, v1.11.21); PR #193 (round-1 wrong-mint class)
- Workspace doc: `../engram-workspace/docs/context/crdt-wrong-mint-cross-file-overwrite.md`
- Relay reference: relay/Relay/src/main.ts ~1355-1505

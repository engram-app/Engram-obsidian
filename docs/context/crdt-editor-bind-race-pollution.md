# Editor binding: stale-buffer pollution, unseeded-doc base loss, boundary inserts

_Last verified: 2026-10-03_

Three bug classes in the editor<->Y.Text binding. The client was rebuilt on Relay's model in July 2026 (#331): the old `editor-controller.ts` is gone and the binding is now a per-`EditorView` ViewPlugin, `src/crdt/live/live-binding.ts` + `live-binding-decisions.ts`. The classes still apply to any change there.

## 1. A reused editor surface must be detached synchronously at the switch boundary (#194)

Obsidian reuses one CM6 `EditorView` across note switches. The old binder awaited the new note's Y.Text while the OLD binding was still attached; during the await Obsidian replaced the whole editor document with the new file, and the old binding forwarded that as a local edit into the OLD note. Result: one note's full content copied into another, server-side, with a clean noteIdMap. The 3s drift repair had the same hole (it never checked which file the view showed).

Rule: tear the binding down synchronously before any await, and never trust the buffer while a file load is in flight. A stale-bound gap is data loss; an unbound gap is only "no live sync until the next refresh".

The nested-editor variant (Live Preview table cells build an `EditorView` with the PARENT's `owner`, so `editorInfoField` resolves to the same file) is closed by `ownedMarkdownPath`: bind only when `info.editor?.cm === view`. See `live-binding-table-cell-editor.md`.

## 2. An unseeded doc plus a non-empty editor must DEFER, never reconcile (#257)

`flushFromCrdt` writes base to disk and deliberately leaves the Y.Doc empty (adopt-first: the server seeds the doc on its own lineage; a local seed forks a second lineage, the #846 doubling). If bind-time reconcile runs while `ytext.length === 0 && editor.length > 0`, it deletes base out of the editor and the binding pushes that delete as a local op: base lost on the server and every device. `decideReconcile` returns `defer` for exactly this case; never seed the doc locally to "fix" it. A genuine user delete-all is a live edit on an already-seeded doc.

Related: a catch-up that fakes convergence (records a hash or seq for bytes it never applied, or serves a stale head) leaves a live-bound note deaf, because the editor owns the file and nothing re-solicits it. See `sync-catchup-convergence.md`.

## 3. Zero-width edits at a region boundary (frontmatter guard)

The binding forwards edits to the body-only Y.Text and drops edits inside the frontmatter block `[0, prefix)`. A guard written `toA <= prefix` swallows a pure insert at `prefix` (typing at the start of the first body line; with no frontmatter, prefix 0 and position 0), shifting every later keystroke's offsets and mangling the line until the 3s drift check snaps it. `classifyEditSpan` checks `fromA >= prefix` (body) BEFORE `toA <= prefix` (frontmatter); frontmatter is the half-open range `[0, prefix)`. Any "is this edit inside region X" guard must decide which side owns the boundary for zero-width edits; deletions spanning the boundary mask the bug, so only typing bites. A whole frontmatter block appearing in one transaction (paste, fence completion) is handled by `fmCreationBodyDiff`, which forwards a body-before to body-after diff, empty for a pure frontmatter paste.

## Testing

The test harness is fake-view + real Y.Doc with no DOM, so tests pin structural invariants: `tests/crdt-live-binding-decisions.test.ts` (`decideReconcile`, `classifyEditSpan`, `ownedMarkdownPath`) and `tests/crdt-live-views.test.ts`.

## Related

- `crdt-sync-store-hiding-layers.md`: the `pathForId` seam that turns a hidden path into a second minted id
- `live-binding-table-cell-editor.md`
- Mint-resurrection and handshake-lane background: `../engram/docs/context/crdt-room-lifetime-and-drain.md` (engram repo)

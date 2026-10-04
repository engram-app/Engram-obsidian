# Any path that writes a CRDT doc to disk must use a projection, never the body alone

_Last verified: 2026-10-03_

Plugin #483 wave, PR #482. The teardown flushes wrote the body `Y.Text` alone and stripped the frontmatter.

## Fingerprint

Close a note in Obsidian: its `---` block is gone from the file on disk, while the web app still shows every property. Edit it again in Obsidian and the properties vanish from the web app and every device. Edit in the web app and the file heals. That asymmetry is the diagnosis: **close breaks it, a web edit fixes it.** Anything flushing through `ProviderRegistry`'s remote-update listener (`project(entry)`) writes the whole file; the two teardown flushes did not.

## Mechanism

`ProviderRegistry.getText` returns the body `Y.Text` ALONE. Frontmatter lives in separate shared types keyed in `src/crdt/frontmatter-codec.ts` (`frontmatter`, `frontmatter_raw`, `frontmatter_order`); only `project()` reassembles them into a file. `CrdtLiveViews.onLastViewerRelease` (every close) and `destroy()` (quit, stack-swap reconnect) both reached for the body.

Why it stayed invisible, then escalated:

1. The Y.Doc is never touched; the flush only writes disk, so server and web keep every key.
2. The plugin suppresses its own damage: `flushFromCrdt` ends in `recordCrdtBaseline(content)` stamping the body-only hash, so `pushFile`'s echo filter matches the flush's own modify event and skips it.
3. The NEXT edit hashes differently, re-ingests the fenceless file, and `seedContentInto` correctly reads "no fence" as "the user removed all properties" (`order=[]`, `values={}`); `applyFrontmatterInto` deletes every absent key. A local-only loss becomes a CRDT deletion on every device. Steps 2 and 3 are right for a genuinely fenceless file, which is why a wrong flush is so expensive.

## Fix and rules

- `onLastViewerRelease` awaits `manager.projectedText(noteId)`; `destroy()` uses `ProviderRegistry.residentProjection(noteId)`.
- **`residentProjection` must stay synchronous.** `destroy()`'s callers fire `destroyAll()` on the next statement without awaiting; an awaited projection would `toJSON()` a dead doc and flush `""` over the note.
- It uses `ensureEntrySync`, so **every caller must gate on `hasDoc(noteId)`** first or it materializes a fresh empty doc and flushes `""` over a real file.
- **Any new disk-write path uses `projectedText`/`residentProjection`, never `getText`.** They are neighbours on one object told apart by name alone. In `src/`, `getText` has no production caller beyond a vestigial field on `reconcileColdStart`'s port type; treat any new caller as suspect. It is kept because ~100 tests use it for body assertions.
- **A fourth shared type is not implemented here.** The web SPA writes `frontmatter_types` (per-key property type; engram repo `frontend/src/crdt/frontmatter-doc.ts`, `TYPES_KEY`); the plugin neither reads nor writes it and `project()` cannot emit it. Known gap, not fixed by this change.

## The rest of the #483 wave (same shape: a path that handles "the note" but means "the body")

1. `seedContentInto` conflated "no frontmatter" with "unparseable frontmatter" (both gave `order=[] values={}`), so one half-typed YAML line wiped every key.
2. The bound-flush save-nudge reverted inbound frontmatter.
3. Frontmatter typed into an OPEN note reached the doc by no route (the binding drops frontmatter keystrokes, and `sync.ts` skips the disk-driven CRDT route while a note is open): fixed by `ProviderRegistry.ingestFrontmatter` / `seedFrontmatterInto`.
4. This one.

All four were invisible to a body-driven suite: the CRDT e2e drove body text, and every frontmatter test originated its edit with `write_note` (the disk path, never broken). Reproducing needs the edit to come from the bound CodeMirror buffer plus a close/reopen: engram repo `e2e/tests/crdt/test_frontmatter_bidirectional.py::test_typed_frontmatter_survives_close_and_reopen`.

## Tests

`tests/crdt-live-views.test.ts` ("flushes the PROJECTION ... never the body alone"; the manager double returns disagreeing values and counts `getText` reads) and `tests/crdt/provider-registry.test.ts` ("teardown projection includes frontmatter (#483)").

# Textual merge: where an LCA still exists, and which one to use

_Last verified: 2026-11-06_

**Read this before wiring `BaseStore` into anything.** Its content is stale for
CRDT-synced notes, and the previous version of this doc said the opposite.

## The CRDT era: there is normally no textual merge

`src/three-way-merge.ts` and `src/diff.ts` were **deleted** in #322 (Phase C,
"commit to CRDT-only"). The legacy flow — detect conflict, `threeWayMerge(base,
local, remote)`, else show the conflict modal — is gone. Yjs is the merge: a disk
edit is diffed into the Y.Doc as a local edit (`applyLocalEdit`) and the CRDT
converges it with remote history. See `reconcileColdStart` and
`captureDiskDriftBeforeRemote` in `sync.ts`.

So if you think you need a textual 3-way merge, first check whether the edit can
just be routed into the Y.Doc instead. Usually it can.

## BaseStore content is STALE for CRDT-synced notes

`BaseStore` (`base-store.ts`) still exists and still stores last-synced content
per path, but **only the REST paths refresh it**:

- `baseStore.set(...)` is called from the pull/push paths only, each gated on `change.version != null`.
- CRDT-delivered content goes through `recordCrdtBaseline()`, which updates **`syncState.hash` alone**, never the base content.

Consequence: for a note that is actively syncing over the CRDT socket, the stored
base can be arbitrarily old. Building a patch from a stale base and applying it to
current doc text re-creates the content-doubling class this repo has fought
repeatedly (#846, #188, #234). `syncState.hash` *is* fresh — use
`needsColdReconcile(path, content)` when a boolean "does disk diverge from the
last-synced baseline" is all you need.

## The one place a real LCA is still needed: the live-bind reconcile

> **Superseded in part (2026-10-08):** the `preEditText` base described below is #544: it is only correct if the doc never received the typing, and the sync engine does write disk into an entering doc. Also stale below: the claim that the ViewPlugin is constructed against an empty editor (Obsidian 1.12.7 always constructs it with the file loaded, CDP-verified). Full investigation, failed approaches and the candidate fix: `live-binding-544-investigation.md`.

`decideReconcile` (`src/crdt/live/live-binding-decisions.ts`) runs once when a
note's editor binds to its resident Y.Doc. If the user typed during the async
hydration window, those keystrokes are in the CM buffer but not in the doc, while
the doc may have hydrated from IndexedDB with server-newer content the editor
never saw. Forwarding a whole-text `diff(docText -> editorText)` there deletes
that remote content.

The LCA used is **not** `BaseStore`. It is `LiveBindingValue.preEditText` — the
editor's own full text immediately before the user's first keystroke this attach,
tracked in the ViewPlugin:

- set in `attach()`, and refreshed on every *programmatic* doc change while
  `!ready` (Obsidian's file load is not a user event, and often lands after the
  ViewPlugin was constructed against an empty editor);
- frozen at the first `input`/`delete` user event;
- rewound to `u.startState` on a same-path re-attach that carried a keystroke
  (the genesis-adopt remap), and dropped to `null` across a real file switch.

It is always fresh by construction, and it is exactly the ancestor of "what the
user typed" and "what the doc already held".

`mergeTypedEdits(base, editorText, docText)` then does `patch_make(base,
editorText)` + `patch_apply(..., docText)`, so only the typed hunks land and every
untouched region of the doc survives; the patch context re-locates hunks that
remote text shifted. The dedicated `diff_match_patch` instance runs
`Match_Threshold`/`Patch_DeleteThreshold` at **0.2** (vs the 0.5 defaults): in a
note-sync path a misplaced hunk is silent corruption while a rejected hunk merely
falls back, so it must reject early rather than guess.

Fallback to the old two-way forward (user's keystrokes win) when there is no base,
when the doc has not diverged from the base, or when **any** hunk fails to apply.

## The other LCA consumer: the disk ingest (`applyLocalEdit`)

_Updated 2026-11-06 (Engram#2480, PR 683, after two adversarial reviews)._ `ProviderRegistry.applyLocalEdit` merges a disk edit with `merge3(base, disk, doc)`, so a remote edit that disk never got survives.

- **Base.** NOT `BaseStore`. It is the per-note merge base the engine records with every disk baseline (`recordCrdtBaseline` -> `ProviderRegistry.setMergeBase`), the last text disk and doc agreed on (Relay's per-doc LCA). It lives in the doc's own IndexedDB store as one `{ text, hash }` record (key `merge-base`), written when it changes.
- **Self-validating.** It is never checked against `syncState.hash`, because that hash reaches data.json lazily (hide/unload) while the base is written at once, so after a crash they disagree. The record's own hash only guards against a torn write. A deferred create (a hash-only claim about disk) passes `mergeBase: false`, which CLEARS the base (a tombstone record). An open editor's autosave passes `"if-doc-holds"`: it becomes the base when the doc holds exactly that text (the binding forwards every keystroke, so it normally does), otherwise it clears it. A failed record write deletes the older record, so a stale base is never trusted after a restart.
- **First launch after upgrade.** There is no record yet. The flush path seeds one from disk when disk still hashes to the baseline (`writeCrdtNote`), and so does an ingest of disk at the baseline.
- `lcaFor` is a test-only override.
- **merge3.** Line-level diff3 detects conflicts. Each clashing region is re-merged at character level, so adjacent lines and different words of one line merge. Only a true character overlap is dirty: shared characters, two inserts at one point, or an insert at or inside the other side's replaced range. A region over `CHAR_MERGE_MAX` (64 KB) stays a conflict without a character diff, and every merge diff is capped at 0.15 s (a 1 MB whole-file rewrite took 2.2 s before, about 0.27 s now).
- **merge3 needs an exact base.** From a stale base no 3-way merge is right: a line added in the shared step and deleted by one side looks like the other side inserting it. `tests/review-683` pins that as `test.failing`. Callers that cannot guarantee the base pass `{ charLevel: false }`.
- **Keep-both.** A dirty merge keeps both: disk's text goes to a conflict copy (`onMergeConflict` -> `keepConflictCopy`) and the doc is written back. With no copy possible (a file-system error; 0 such failures in prod Loki over 30 days), only the lines disk holds that the doc lacks are kept IN the doc, under one marker block per note that later rounds append to (no nesting), logged at error. There is no path that reverts either side.
- **Write-back.** A merge that keeps doc work disk lacks is written back to disk (`writeBack`), unless disk moved since the read.
- **Late editor saves.** An editor's late save of a buffer the doc already absorbed (closed tab, close-save lands after a remote flush) is caught by the `localHead` window. It is armed only by editor-origin edits (never disk ingests, origin `DISK`) and cleared by the first ingest. Inside `ECHO_COOLDOWN_MS` it is ignored; past it, the same text is a keep-both, never a fast-forward (and nothing at all when disk already equals the doc).

The live binding's drift repair uses `merge3` LINE LEVEL from the last text editor and doc agreed on. That text (`agreed`, a CM6 `Text`) is advanced by every forwarded edit and every painted delta, and freezes (still a common ancestor) the moment an edit leaves the two sides' lengths out of step. Editor-only text is forwarded to the doc, and doc-only text is painted out of undo history. Ambiguous cases keep the editor's text as a conflict copy before the doc is adopted.

## Gotchas

- A "3-way merge" that reaches for `BaseStore` is almost certainly wrong now (the disk ingest uses the per-note merge base above). Ask
  what the true common ancestor is and whether it is fresh.
- `dirty` (user typed during hydration) and "disk diverges from the baseline" are
  different questions. The reconcile only answers the first; the second is
  `needsColdReconcile`, and the disk-drift class is already handled by
  `reconcileColdStart` / `captureDiskDriftBeforeRemote`.

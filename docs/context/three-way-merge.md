# Textual merge: where an LCA still exists, and which one to use

_Last verified: 2026-10-03_

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

> **Superseded in part (2026-10-08):** the `preEditText` base described below is #544: it is only correct if the doc never received the typing, and the sync engine does write disk into an entering doc. Full investigation, failed approaches and the candidate fix: `live-binding-544-investigation.md`.

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

## The other LCA consumer: `mergeDiskOntoDoc`

`src/crdt/lca-merge.ts` (`mergeDiskOntoDoc(base, disk, current)`, #357) applies a disk edit's delta relative to a base onto the doc's current text so remote ops that landed mid-read survive. Its base IS `BaseStore`, wired in `main.ts` as `lcaFor`. That is the exact staleness hazard above; the guard is that a dirty merge (`clean: false`, a hunk failed to apply) must fall back to the two-way path rather than ship, which `onDirtyMerge` logs as `LCA merge left unapplied hunks`. Treat a stale `BaseStore` base here as a known risk, not a solved one.

## Gotchas

- A "3-way merge" that reaches for `BaseStore` is almost certainly wrong now (the one consumer, `lcaFor`, is described above). Ask
  what the true common ancestor is and whether it is fresh.
- `dirty` (user typed during hydration) and "disk diverges from the baseline" are
  different questions. The reconcile only answers the first; the second is
  `needsColdReconcile`, and the disk-drift class is already handled by
  `reconcileColdStart` / `captureDiskDriftBeforeRemote`.

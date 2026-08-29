# The teardown flush wrote the body Y.Text alone and stripped frontmatter

_Last verified: 2026-08-29_

## Status
Fixed on `fix/451-refuse-mint-over-known-path` (`0c0af6b`, PR #482). Third and
last defect of the #483 wave.

## Failure fingerprint
Close a note in Obsidian → its `---` block is gone from the file on disk. The
web app still shows every property. Edit the note again in Obsidian → the
properties now vanish from the web app too, and from every other device. Edit
the note in the **web app** and the file heals itself.

That asymmetry is the whole diagnosis: **close breaks it, a web edit fixes it.**
Anything that flushes through `ProviderRegistry`'s remote-update listener
(`src/crdt/provider-registry.ts:226`, which calls `project(entry)`) writes the
whole file and repairs the damage; the two teardown flushes did not.

The user's report of the escalation, verbatim: "when I made new frontmatter in
obsidian it wiped the webapp frontmatter."

## What This Is
`ProviderRegistry.getText` (`src/crdt/provider-registry.ts:271`) returns the
body `Y.Text` **alone**. Frontmatter lives in separate shared types; this plugin
implements three, keyed in `src/crdt/frontmatter-codec.ts`:

- `frontmatter` (`FRONTMATTER_KEY`, :17) — the key/value Y.Map
- `frontmatter_raw` (`RAW_FRONTMATTER_KEY`, :19) — degraded-key verbatim spans
- `frontmatter_order` (`ORDER_KEY`, :21) — the ordered key list

Only `project()` (`provider-registry.ts:132`) reassembles them into a file.
Both teardown flushes reached for the body:

- `CrdtLiveViews.onLastViewerRelease` (`src/crdt/live/live-views.ts:242`) —
  `await manager.getText(noteId)` then `flushToDisk`. Fires when the **last
  viewer of a note releases**, i.e. every close.
- `CrdtLiveViews.destroy()` (`live-views.ts:313`) —
  `manager.residentText(noteId).text.toJSON()`. Fires on **quit**
  (`src/main.ts:1378`, `onunload`) and on a **stack-swap reconnect**
  (`src/main.ts:2173`, `connectionKey !== crdtStackKey`).

`deps.manager` is a `ProviderRegistry` (the `CrdtManager` name is legacy).

## Why it stayed invisible, then escalated
1. **The Y.Doc is never touched.** The flush only writes disk. Server and web
   app keep every key, so nothing looks wrong until the file is reopened.
2. **The plugin suppresses its own damage.** `flushFromCrdt` (`src/sync.ts:1869`)
   ends in `recordCrdtBaseline(normalized, content)` (`:1949`), which stamps
   `hash: fnv1a(content)` (`:2032-2040`) — the **body-only** bytes. `pushFile`'s
   hoisted echo filter (`src/sync.ts:4320-4328`) hashes the disk read and
   compares it to that stamp; it matches, logs `Echo skip`, and returns false.
   The modify event the flush itself caused is dropped. That is precisely why
   the loss stayed local instead of being noticed immediately.
3. **It is a loaded gun.** The *next* edit to that note hashes differently,
   clears the echo filter, and re-ingests the fenceless file.
   `seedContentInto` (`src/crdt/note-seed.ts:115`) sees `fmBlock === null` and
   correctly reads that as "the user removed all properties" — `order=[]`,
   `values={}` → `applyFrontmatterInto` (`note-seed.ts:59`) deletes every key
   absent from `values` (`:76-78`). The local-only loss becomes a CRDT
   deletion on every device.

Steps 2 and 3 are not bugs. Given a genuinely fenceless file both are the right
behaviour — which is exactly why a wrong flush is so expensive here.

## The fix (`0c0af6b`)
- `onLastViewerRelease` → `await manager.projectedText(noteId)`.
- `destroy()` → new `ProviderRegistry.residentProjection(noteId)`
  (`provider-registry.ts:287`).

`residentProjection` is `project(ensureEntrySync(noteId))` and **must stay
synchronous**. `destroy()`'s callers fire `crdtManager.destroyAll()` on the very
next statement without awaiting (`main.ts:1378`, `main.ts:2173`) — an awaited
projection would run `toJSON()` on a dead doc and flush `""` over the note. The
existing "capture content BEFORE returning" contract in `destroy()`'s docstring
is what makes destroy-then-destroyAll safe; a projection that awaits breaks it.

Because it uses `ensureEntrySync` (`provider-registry.ts:173`), **every caller
must gate on `hasDoc(noteId)` first** (`live-views.ts:329`) or it materializes a
fresh empty doc and flushes `""` over a real file.

## Gotchas
- **Any new disk-write path must use a projection, never `getText`.**
  `ProviderRegistry` exposes `getText` (body) at :271 and `projectedText`
  (whole file) at :276 as neighbours on one object, telling them apart by name
  alone. That is the trap; the teardown reached one line too high.
- `getText` was **not** removed — ~100 test-suite call sites use it for body
  assertions. Note that in `src/` it currently has **no production caller**: the
  only reference is a vestigial `getText` field on `reconcileColdStart`'s port
  type (`src/sync.ts:180`, wired at `src/main.ts:1178`) that the function body
  never reads (it uses `projectedText`, `sync.ts:196`). If you are auditing,
  treat any *new* `getText` caller as suspect by default.
- **There is a FOURTH shared type this plugin does not implement.** The web SPA
  writes `frontmatter_types` (`engram: frontend/src/crdt/frontmatter-doc.ts:38`,
  `TYPES_KEY`, read via `frontmatterMaps().types` at :50) — a per-key property
  type. `src/crdt/frontmatter-codec.ts` defines no counterpart, so the plugin
  neither reads nor writes it and `project()` cannot emit it. A typed property
  (list / number / checkbox / date) set in the SPA therefore carries a type the
  plugin has no representation for. **Known gap, NOT part of this fix and not
  fixed by it** — do not read "the plugin has three keys" as "three keys exist".

## Why every existing test passed
The CRDT e2e suite drives **body** text, and every frontmatter test to date
originated its edit with `write_note` — the disk path, which was never broken.
Reproducing needs the edit to come from the **bound CodeMirror buffer** plus a
close/reopen. The repro lives in the backend repo:
`e2e/tests/crdt/test_frontmatter_bidirectional.py::test_typed_frontmatter_survives_close_and_reopen`
(branch `test/483-frontmatter-bidirectional-e2e`, engram PR #1517).

## Regression tests
- `tests/crdt-live-views.test.ts` — "flushes the PROJECTION (frontmatter +
  body), never the body alone". The manager double returns *disagreeing* values
  for `projectedText` and `getText` and counts `getText` reads, so the teardown
  reaching for the body fails the test even if the flush content were somehow
  right.
- `tests/crdt/provider-registry.test.ts` — `describe("teardown projection
  includes frontmatter (#483)")`: `projectedText` round-trips the block,
  `getText` is asserted body-only (so the two never read as equivalent),
  `residentProjection` equals `projectedText` without an await, and a note with
  no frontmatter projects unchanged (no stray fence).

## The rest of the #483 wave (same branch, same PR)
1. `f118759` — `seedContentInto` conflated "no frontmatter" with "unparseable
   frontmatter"; both produced `order=[] values={}` and deleted every key, so
   one half-typed YAML line wiped the lot (`note-seed.ts:119-152`).
2. `8f691d6` — the bound-flush save-nudge reverted inbound frontmatter.
3. `206c5f8` — live-bound frontmatter ingest (`ProviderRegistry.ingestFrontmatter`
   / `seedFrontmatterInto`): the binding drops frontmatter keystrokes
   (`classifyEditSpan` → "frontmatter") and `sync.ts` skips the disk-driven CRDT
   route while a note is open, so frontmatter typed into an **open** note
   reached the doc by no route at all.
4. This one (`0c0af6b`).

All four are frontmatter-shaped and all four were invisible to a body-driven
test suite. If a fifth turns up, assume the same shape: a path that handles
"the note" but means "the body".

## References
- `src/crdt/live/live-views.ts:242` (`onLastViewerRelease`), `:313` (`destroy`)
- `src/crdt/provider-registry.ts:132` (`project`), `:271` (`getText`), `:276`
  (`projectedText`), `:287` (`residentProjection`), `:226` (remote-update flush)
- `src/crdt/frontmatter-codec.ts:17,19,21` — the three keys the plugin implements
- `engram: frontend/src/crdt/frontmatter-doc.ts:38` — `frontmatter_types`, the
  fourth shared type, SPA-only
- `src/crdt/note-seed.ts:59` (`applyFrontmatterInto`), `:115` (`seedContentInto`)
- `src/sync.ts:1869` (`flushFromCrdt`), `:2032` (`recordCrdtBaseline`),
  `:4320` (`pushFile` echo filter)
- `src/main.ts:1378`, `:2173` — the two `destroy()` → `destroyAll()` sites
- `docs/context/frontmatter-boundary-insert-drop.md` — adjacent frontmatter/body
  boundary bug in the editor binding
- Plugin #483, PR #482; backend e2e PR engram#1517

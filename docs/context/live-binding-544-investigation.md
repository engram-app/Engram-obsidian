# Context Doc: #544 live-binding merge base, the full investigation (TABLED)

_Last verified: 2026-10-08 (plugin `origin/main` at the time, Obsidian 1.12.7, Relay v0.8.12)_

**Read this before touching the live binding's go-live reconcile, the "merge base" for typing done while a note is still loading, or any sync-engine path that writes disk content into a CRDT doc.** One session burned a full day on #544 by redesigning instead of reading history. Everything learned is here.

## Status

**Tabled on 2026-10-08 by decision, not because it was solved.** Reasons:

- Nobody has reported it. The window is narrow: the user types while the note is still loading, Obsidian autosaves, and a sync-engine disk write lands in that same window.
- Relay ships the same bug (proved below by running Relay's code), and nobody reports it there either.
- A real fix touches the sync engine's core write paths. That risk outweighs this edge case.

Spun off and filed separately (independent, small, real on `main`): **#561**, the binding goes live twice after switching away and back before a note loads.

Revisit #544 when a user hits it, or when the sync engine's disk-to-doc paths are being reworked anyway.

## The bug, precisely

`LiveBindingValue` (`src/crdt/live/live-binding.ts`) attaches a CodeMirror editor to a note's Y.Text immediately, but goes **live** (starts forwarding keystrokes and painting remote deltas) only after:

1. the Y.Doc hydrates from IndexedDB (`residentText().ready`), and
2. if the doc is empty while the editor is not, after the server seeds it (`deferSeed`).

Call that window **"entering"** (Relay's name). During it the user can type. The typing exists only in the editor buffer. Obsidian autosaves it to disk. At go-live the binding must reconcile **editor text** with **doc text**, which requires knowing what both came from (a merge base).

On `main` the base is `preEditText`, the editor's text before the first keystroke (`decideReconcile` / `mergeTypedEdits` in `live-binding-decisions.ts`, introduced by PR #331). That is only correct if the doc never received any of the typing. It can, because **several sync-engine paths write the disk file (which holds the autosaved typing) into the doc while the note is entering.** Then the merge sees the typing as "new" relative to the base and the doc as "moved", and you get:

- **Remote-edit revert** (reproduced in real Obsidian, below): the merge is rejected, the reconcile falls back to forwarding the editor over the doc, deleting a remote edit.
- **Doubling** (reproduced in unit probes, 30 of 135 layouts): `patch_apply` re-inserts typing the doc already holds.
- **Lost keystrokes on re-attach** (genesis-adopt id remap under an open editor, triggered by a click rather than a keystroke).

## Root cause (proved)

**The sync engine writes disk content into the doc of a note whose binding is attached but not yet live.** The binding's merge-base choice is a symptom; no binding-only change fixes it.

Proof, in real Obsidian 1.12.7 (method: `obsidian-cdp-binding-probe.md`; harness on branch `proto/544-golive-rebase`, `scripts/probes/544/obsidian/`): the real binding bundled with a fake coordinator, real typing, real Obsidian autosave. Sequence S2 = type `TTT`, autosave, type `UUU`, remote edit on line 1, go-live.

| Binding | Fake sync engine writes disk into the entering doc (today's behaviour) | S2 |
|---|---|---|
| `origin/main` | yes | **FAIL**: remote edit reverted |
| prototype go-live (below) | yes | **FAIL**: same |
| prototype go-live | no | **PASS** |

### The disk-to-doc writers (the channel to close)

Audit taken at `d4c6409` (a branch commit, NOT on `main`); `sync.ts` line refs past ~2700 run about 10 lines LOW against `main` (`handleModify` gate is 4026 on `main` at 0203f4a, fan-out check 6729). Treat every line ref as approximate and grep the function name. `isLiveBound(path)` = `CrdtLiveViews` viewer refcount (`main.ts` ~2795 -> `live-views.ts`), which is **true from `attach()`, before the binding is live**. Nothing exposes "live". It is keyed by path while writes are keyed by note id. Gates are per site and inconsistent:

| Path | Site (sync.ts unless noted) | Gate |
|---|---|---|
| `handleModify` (autosave) | ~4026 | `isLiveBound` body skip (correct) |
| `pushFile` CRDT op branch -> `routeModify` -> `applyLocalEdit` | ~4981, 146 | **none** (reached by post-pull drain ~7122, debounce ~4094, forced `pushAll` ~10381/10482, conflicted replay ~11101, resurrection ~8680, rename ~4544) |
| `seedBodyAfterCreate` (create ack) | ~3566 drift merge, ~3570 `flushFromCrdt`, ~3666 `routeModify` | **none**; reached via `repairOrphanedClaim` -> `applyCrdtCreateAck` (~1200, ~1754) AND directly from `pushFile`'s inline genesis branch (~5222, create-and-adopt); the main #544 seeder |
| genesis frame | ~1786 `eligibleForGenesisFrame` | checked at BUILD, not at ack |
| mint adopt | ~1717-1726, ~5149-5183 | refcount treats pending as live |
| cold-start reconcile | 195-215 via `main.ts` ~1185-1231 | **none** |
| vault fan-out drift capture | ~6729 check, ~6776 await, ~2357 write | check-then-await (TOCTOU) |

Disk-to-doc writes enter the doc through **two** functions: `ProviderRegistry.applyLocalEdit` (`provider-registry.ts` ~380; every row above except the next one) and `applyRemoteUpdate` with the **genesis frame** in `seedBodyAfterCreate` (`sync.ts` ~3568), a Yjs update encoded from the note's disk text (`genesisContent`) when the create was built. A guard in `applyLocalEdit` alone leaves the genesis path open: a create-ack for an open, still-entering note writes disk into its doc. The guard must cover both (or sit below both). All doc-to-disk writes funnel through `flushFromCrdt` (~2018). Those are the two natural choke points. Doc-to-disk has the mirror problem: release/destroy flushes (`live-views.ts`), the bound frontmatter flush (`wiring.ts` ~321-337; `lastFlushedFm` lives in `provider-registry.ts` ~240-260 and starts null, so the first remote update on any note with frontmatter writes), and `recordLiveBoundBaseline` stamps disk as synced while entering.

## What Relay actually does (run, not read)

Relay's tests are git-crypt encrypted, so its real `MergeHSM.ts` + `replayBufferedEdits.ts` were bundled and driven directly (harness: `proto/544-golive-rebase:scripts/probes/544/relay/`). Editor-plugin buffering was emulated line by line from `HSMEditorPlugin.ts`.

Relay's layering (file refs are `Relay/src/merge-hsm/`):

1. **Entering:** editor typing is never written to the doc (`MergeHSM.ts` 3457-3478, `machine-definition.ts` 589-605). Disk changes are only accumulated; the latest wins (3479-3490). **Disk never writes the doc of an open note.**
2. **Go-live:** `diff3(LCA, doc, latestDisk)` (4041-4090, `diff3.ts`). No LCA: two-way, equal is clean, else conflict, nothing dropped (4092-4150).
3. **Typing:** replayed as raw keystroke positions (`HSMEditorPlugin.ts` 536-541). Its correct rebase (`rebaseBufferedTextAcrossReplacement`, using already-ingested `"set"` texts as the patch base) only runs when Obsidian happens to reload the editor.
4. **Tracking:** a `"set"` equal to the doc is ignored (3658); others apply as a text diff (3745-3750). Never write disk while open (`Document.ts` 1612).
5. **LCA** is a record `{contents, meta, snapshot}`; the local doc uses a `gcFilter` that pins items the LCA snapshot references (`MergeHSM.ts` 5457, `_lcaGcPinCache`), so the agreed version is reconstructable as a Yjs state.

Results:

| Sequence | Relay |
|---|---|
| type T, autosave, type U, go-live (per keystroke) | **T doubled, U misplaced**; drift banner 3s later, after the bad text synced |
| same + remote edit while entering | **T doubled inside a word** |
| stale `"set"` echo after a painted remote edit | remote edit reverted (synthetic harness only; not reachable in real Obsidian, see below) |
| two panes, saved deletion, no LCA | correct |

**Relay has #544.** A faithful port ships the bug. Its shape (1, 2, 4, 5) is right; step 3 is the hole.

## Obsidian 1.12.7 facts (CDP-verified)

Details in `obsidian-cdp-binding-probe.md`.

- **Pane mirror:** every change in one pane is mirrored to other panes on the same file asynchronously (under 300ms) as `userEvent: "set"`, a minimal diff to the source pane's **current** full text. No-op when equal. It reads the source's current text when applied, so it is never stale in practice.
- **External modify** of an open file reloads the editor via `"set"`; with unsaved typing Obsidian merges and writes the merge back to disk. External edits reach an open note through the editor.
- **The ViewPlugin is always constructed with the file already loaded** and `owner.editor.cm === view` (new tab, same-leaf switch, startup restore, deferred tab, late plugin load). Comments claiming otherwise are stale: `live-binding.ts` ~166-169 ("constructed against an empty editor"), the `ownedMarkdownPath` docstring in `live-binding-decisions.ts` ~27-29, and the body of `three-way-merge.md`.
- **Live Preview's CM doc includes the frontmatter block.** The "Live Preview is body-only" claim is stale in `live-binding.ts` 21-23, `live-binding-decisions.ts` ~49-50, `wiring.ts` ~324-327 and `provider-registry.ts` ~250-255 (where it is the stated reason `fmChanged` does not consult the editor). The binding is safe because it slices with `frontmatterPrefixLen`; re-check the `fmChanged` reasoning before relying on it.

## Failed approaches (do NOT repeat)

Every one of these was built, tested, and broken by review or by running code.

1. **`preEditText` as the base** (PR #331, shipped on `main`). Correct only if the doc never got the typing. It does (root cause). This is #544.
2. **Disk text as the base** when disk moved off `preEditText`. Reverts saved typing when the doc was seeded by the server (the autosave never reached it), because the sync engine's gate skips bound notes in `handleModify` but not elsewhere.
3. **"Does the doc contain the saved hunks" substring check.** A deletion-only save searches only for its context, which is always present: saved deletions get restored.
4. **Pick the base closest to the doc by edit distance.** Loses typing when an older autosave seeded the doc; ties (diff-match-patch Levenshtein scores adjacent insert+delete as max, not sum) pick the wrong base; two full diffs can freeze the UI on big notes.
5. **Single-writer specs r1-r4** (editor owns the body while entering; per-site gates; pre-edit snapshot seeding; per-note ownership record). Each review found 8-13 new loss/doubling holes, because each round improvised the one thing Relay already has: one closed disk channel plus a persisted agreed version.
6. **A faithful Relay port (r5).** Mis-mapped Relay: it skipped the editor-buffer layer (the one #544 lives in). And Relay has the bug anyway (above).
7. **diff-match-patch `patch_apply` for any merge.** It re-inserts an insertion the other side already holds (doubling), and misplaces hunks next to repeated lines (seed 551 in the fuzz: typed `UU` glued onto a remote edit's line). Use diff3, or better, the CRDT itself.
8. **One-shot diff3 as a fuzz oracle.** Next to repeated identical lines it applies a single edit to several copies; use line-identity oracles (see `tests/crdt-go-live-fuzz.test.ts` on the prototype branch).

## The candidate design (r6) and the open question

Spec (vault): `50 Engineering/_Superpowers Specs/2026-10-08-live-binding-single-writer-design.md` (status r6). Prototype: branch `proto/544-golive-rebase` (commits `8aa5e62`, `dc5ab7d`, `37168a1`, `1a1b1a9`).

r6 = Relay's layering + one change:

1. Close the disk-to-doc channel while a note is entering (guard in `applyLocalEdit` AND the genesis `applyRemoteUpdate` in `seedBodyAfterCreate`; guard doc-to-disk in `flushFromCrdt`). **This is the root fix.**
2. At go-live: `merged = diff3(LCA, doc, diskSide)` where `diskSide` = latest autosave while entering, else the text the editor loaded.
3. Rebase unsaved typing: `diff3(diskSide, merged, editor)` (`diskSide` is an exact common ancestor by construction: autosave snapshots this editor; step 2 merged it into the doc). Same-line conflict: doc wins in the editor, editor text kept for a conflict copy.
4. Record the LCA at every point doc and disk agree (#364; `BaseStore` is stale for CRDT notes today, see `three-way-merge.md`).

Prototype evidence: pure `goLive` seeded fuzz with line identity, 20,000 layouts: 0 doubled or dropped, 5% conflicts. Real Obsidian: S1-S6 pass with the channel closed.

**Open question raised by the user, NOT resolved: why a text merge at all?** A text 3-way merge is only needed because entering-window typing never becomes Yjs operations. The CRDT can merge it natively if the typing is applied as ops against the Yjs version the editor actually showed: keep a Yjs **snapshot** of the agreed version (Relay does, with a `gcFilter` that pins its items), rebuild it with `Y.createDocFromSnapshot`, apply `diff(loadedText -> editorText)` there as local ops, and merge that update into the live doc. That would replace steps 2-3 with CRDT semantics (no diff3, no conflict copies). Costs: our docs use default GC (`new Y.Doc()`, `provider-registry.ts` ~206), so a Relay-style pinning `gcFilter` is required; a snapshot store; a text fallback when the loaded text matches no recorded version (disk drift while closed, evicted IndexedDB). **Not prototyped.** Whoever resumes should evaluate this before committing to diff3.

## History (read these too)

- Vault specs: `2026-06-28-plugin-live-editor-crdt-binding-design.md` (ported Relay's binding and decided "the HSM merge state machine itself is NOT ported", which dropped Relay's accumulate-disk-while-entering rule: the #544 channel); `2026-06-29-plugin-live-editor-hardening-ycollab-design.md`.
- PRs: #160 (first binding), #194 (file-switch pollution), #257 (defer on unseeded doc, #846), **#331** (Relay persistent-doc rebuild; introduced the `preEditText` merge), #357/#368 (LCA 3-way default in `applyLocalEdit`), #364, #539/#543 (empty mint adopt), issues #544, #561.
- Docs: `three-way-merge.md` (BaseStore stale), `crdt-editor-bind-race-pollution.md`, engram repo `docs/context/crdt-lineage-doubling.md`, workspace `docs/context/deaf-livebound-base-loss-diagnosis.md` and `relay-pattern-audit.md`.

## Process lessons (the expensive part)

- **Search history first:** `gh pr list --state all --search "<area>"`, `gh issue list --state all`, this repo's `docs/context/`, the vault specs. The day-one fixes re-trod PR #331.
- **Relay is the template, but run it, do not read it.** Reading Relay's code produced a confident, wrong mapping (r5). Running it showed Relay has the bug.
- **Reproduce in real Obsidian before designing.** The real-Obsidian run is what finally separated the root cause (sync-engine channel) from the symptom (binding merge base). The harness takes about 20 minutes to stand up; it should have been step one.
- **Distrust text-merge heuristics on notes.** Repeated lines (todo lists, blank lines) defeat fuzzy patching and naive oracles.

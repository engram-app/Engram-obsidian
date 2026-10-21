# CRDT Single-Ingest Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One per-note gate in `ProviderRegistry` is the only path that writes local text into a note's Y.Doc. A history-less doc for a note the server holds is never written from local text: edits wait in a durable pending queue until the server lineage arrives, then replay as a diff.

**Architecture:**
- A pure decision module, `ingest-gate.ts`, holds the replay rules.
- The registry gets `ingest()`, which replaces `applyLocalEdit()`, plus an `onLineage` replay hook on every arrival path.
- Two durable stores back the gate: the pending queue (plugin data) and the discovery base (IndexedDB).
- SyncEngine and the live binding call `ingest()`; neither writes Yjs directly.
- A boot-time migration quarantines rival ops minted by older plugins.

**Tech Stack:** TypeScript, Yjs 13, y-indexeddb, bun test, the sim tier (`tests/sim`).

**Spec:** Engram vault `50 Engineering/_Superpowers Specs/2026-10-21-crdt-single-ingest-design.md`, including its "Review additions" section. Read both, the spec first.

**Base branch:** rebase onto plugin #598, then #604, as cleanup merges them, before Task 5 (the first task that edits `src/sync.ts`). Tasks 1-4 do not touch `sync.ts`.

**Supersedes:** PR #619. Carry over its tests (Task 9), then close it with "superseded by <this PR>".

## Global Constraints

- **Never seed blind.** No code path may insert local text into a history-less doc unless the note is `local` (`isUnackedMint(noteId)` or no id). There is no fallback to seeding on timeout, latch or error.
- **Server-known by default (fail closed):** `isServerKnown(id) = id !== null && !isUnackedMint(id)`.
- **Replay rules, in this order:**
  1. `fnv1a(S)` equals the baseline (`syncState[path].hash`) and also equals `fnv1a(B)` or `fnv1a(canon(B))` → apply T.
  2. `merge3(B, T, S)` is clean → apply the merge.
  3. B is null and `onlyInserts(S, T)` → apply T.
  4. Otherwise keep both.

  Canvas: rules 1 and 4 only.
- **Ordering:** disk is written BEFORE the doc is touched. A refused write leaves the entry pending.
- **Backoff while pending:** `[2_000, 10_000, 30_000, 60_000]` ms, with the last step repeating. Attempts run only while the CRDT channel is joined. On rejoin, catch-up or vault re-open, all pending notes retry with concurrency 4.
- **Sync Center:** a note pending for 10 min (`600_000` ms) gets an issue with the new key `"Waiting for the server's copy before syncing this edit."`, category `"other"`. It clears on replay.
- **Translations:** machine-translated with `scripts/i18n-translate.ts` (translategemma), never by hand. No native-review gate.
- **Discovery base:** stored for notes under `MAX_CRDT_NOTE_BYTES` only. The entry is dropped when lineage arrives or the baseline hash no longer equals `fnv1a(B)`.
- **No version bumps.** release-please owns versions.
- **Gates before push:**
  - `bunx biome check src tests`
  - `bun run lint:obsidian`
  - `bun run build`
  - `bun test` (the pre-push hook)
- **Box rules:** at most one heavy subagent at a time, under `systemd-run --user --scope -p MemoryMax=4G`. Never `git stash`.

## Review Focus

1. **Open editor + typing during the lineage round trip.** The text typed while `crdt_doc_state` is in flight must be in the merged result. Test in Task 7: `typed during the round trip survives the replay`.
2. **Note deleted while pending.** The entry is dropped and no doc is resurrected. Test in Task 3: `delete drops the pending entry and never replays`.
3. **Note renamed while pending.** The entry follows the note id and the replay writes to the new path. Test in Task 5: `rename while pending replays to the new path`.
4. **Vault switch while pending.** No timer fires into the other vault, and the entry resumes when the vault returns. Test in Task 3: `vault switch parks entries and resumes them`.
5. **Huge note over `MAX_CRDT_NOTE_BYTES`.** It never enters a doc or the base store and stays on the legacy path, exactly as today. Test in Task 5: `oversized discovered note is not gated or stored`.

---

### Task 1: Replay decision module

**Files:**
- Create: `src/crdt/ingest-gate.ts`
- Test: `tests/crdt/ingest-gate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ReplayInput = { server: string; text: string; base: string | null; baselineHash: number | undefined; kind: "note" | "canvas" };
  export type ReplayDecision = { kind: "apply"; text: string } | { kind: "keep-both" };
  export function decideReplay(i: ReplayInput, canon: (t: string) => string): ReplayDecision;
  ```
- Consumes: `merge3`, `onlyInserts` from `src/crdt/lca-merge.ts`. Port `onlyInserts` from #619 commit 683c56bd if it is not on main. Also `fnv1a` from `src/content-hash.ts`.

- [ ] **Step 1: Write failing tests**, one per rule plus the #1928 case:
  - `server unchanged → apply text`: `server=C1`, `baselineHash=fnv1a(C1)`, `base=C1`, `text=C2` → `{apply, C2}`
  - `canonicalized server counts as unchanged`: `server=canon(B)` with `key: null`, `B` with `key:` → `{apply, text}`
  - `server moved, base known, clean merge`: `server="REMOTE\n"+C1`, `base=C1`, `text=C2` → `{apply, "REMOTE\n"+C2}`
  - `no base, only inserts → apply`, and `no base, deletes server text → keep-both`
  - `canvas never merges`: canvas, server moved → `keep-both`
- [ ] **Step 2:** `bun test tests/crdt/ingest-gate.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `decideReplay`. It is pure, with no Yjs and no I/O.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(crdt): ingest replay decision rules`.

### Task 2: Root-client sets (shared by migration and tests)

**Files:**
- Create: `src/crdt/root-clients.ts`
- Test: `tests/crdt/root-clients.test.ts`

**Interfaces:**
- Produces:
  - `export function rootClients(doc: Y.Doc): Set<number>`: clients owning a `content` item with `origin === null && rightOrigin === null`.
  - `export function canonText(text: string, kind: "note" | "canvas"): string`: a throwaway doc seeded via the existing codec, then projected.

- [ ] **Step 1: Failing tests** (mirror backend #2113 `yjs_lineage.rs`):
  - `one lineage edited elsewhere = 1`
  - `fresh seed into existing = 2`
  - `clear and retype = 1`
  - `frontmatter map entries ignored`
  - `canonText adds key: null`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Walk `text._start` through `.right`. `canonText` reuses `seedContentInto` / `seedCanvasInto` on a throwaway `Y.Doc` and the projection the registry uses. Move the registry's `project()` into a free function if it is not already exported.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat(crdt): root-client set and codec canon helpers`.

### Task 3: Durable stores

**Files:**
- Create: `src/crdt/pending-ingest-store.ts`, `src/crdt/discovery-base-store.ts`
- Test: `tests/crdt/pending-ingest-store.test.ts`, `tests/crdt/discovery-base-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PendingEntry = { noteId: string; path: string; vaultId: string; base: string | null; baseHash: number | null; enqueuedAt: number; source: "disk" | "editor" | "create-transfer" | "cold-start" | "migration"; text?: string };
  export class PendingIngestStore {
    constructor(load: () => PendingEntry[], save: (all: PendingEntry[]) => Promise<void>);
    get(noteId: string): PendingEntry | undefined;
    put(e: PendingEntry): Promise<void>;     // coalesce: keeps the OLDEST base/baseHash/enqueuedAt, newest path/text/source
    delete(noteId: string): Promise<void>;
    forVault(vaultId: string): PendingEntry[];
  }
  export class DiscoveryBaseStore {           // IndexedDB "engram-discovery-base/<vaultId>", keyed by noteId
    constructor(vaultId: string);
    put(noteId: string, text: string): Promise<void>;
    get(noteId: string): Promise<string | null>;
    delete(noteId: string): Promise<void>;
  }
  ```
- `text` is set only for `source` `"migration"` and `"editor"` (see the spec, (d) and editor input).

- [ ] **Step 1: Failing tests:**
  - `put coalesces and keeps the oldest base`
  - `persists through save/load`
  - `delete drops the pending entry and never replays` (store level: `get` returns undefined after a delete and a reload)
  - `vault switch parks entries and resumes them`: `forVault` filters, and entries survive a reload
  - `discovery base round-trips under fake-indexeddb`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. `save` is awaited inside `put`/`delete`, so the entry is durable before the call resolves.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat(crdt): durable pending-ingest and discovery-base stores`.

### Task 4: Registry gate: `ingest()` and `onLineage`

**Files:**
- Modify: `src/crdt/provider-registry.ts`
  - `applyLocalEdit` becomes `ingest`
  - flush listener
  - `applyRemoteUpdate`
  - provider `onSynced`
  - `entry.ready`
- Test: `tests/crdt/registry-ingest.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces, on the registry:
  ```ts
  export type IngestInput = { text: string; base: string | null; source: PendingEntry["source"]; reread?: () => Promise<string> };
  export type IngestResult = { consumed: string } | { pending: true };
  ingest(noteId: string, input: IngestInput): Promise<IngestResult>;
  ```
- New `ProviderRegistryOpts`, replacing `serverLineage` and `isUnchangedSynced` for this purpose:
  ```ts
  isServerKnown(noteId: string): boolean;
  baselineHash(noteId: string): number | undefined;
  pending: PendingIngestStore; discoveryBase: DiscoveryBaseStore;
  requestLineage(noteId: string): void;                       // engine drives crdt_doc_state / enroll (Task 6)
  writeConflictCopy(noteId: string, text: string): Promise<boolean>;
  editorText?(noteId: string): string | null;                 // live binding (Task 7)
  paintEditor?(noteId: string, text: string): void;
  ```

**Behaviour:**
- **`local`:** seed as today.
- **`live`:** today's LCA and stale-snapshot path.
- **`awaiting`:** `pending.put`, then `requestLineage`, then return `{pending: true}`.
- **`onLineage`** fires when the doc goes from no history to history (`docHasAnyHistory`) on any arrival path, and only if a pending entry exists. It then:
  1. builds T from `editorText?.()`, else `entry.text`, else the disk read;
  2. calls `decideReplay`;
  3. writes the result to disk first (`onFlushToDisk`), or the conflict copy for keep-both;
  4. diffs the result into the doc;
  5. calls `paintEditor` when bound;
  6. deletes the pending entry and the discovery base.

  Steps 1-5 run synchronously after the arrival apply.
- **The flush listener skips its plain flush while a pending entry exists for the note.**
- **Make `seedContentInto`, `seedCanvasInto`, `seedFrontmatterInto` and `diffIntoYText` importable only by `provider-registry.ts`, `note-seed.ts`, `bridge.ts` and `root-clients.ts`** (meta-test in Task 9).

- [ ] **Step 1: Failing tests** (real registry, fake-indexeddb, a server `Y.Doc` as in #619's `scenario()`):
  - `awaiting: ingest queues and mints no ops` (doc has no history, `pending.get` is set, `requestLineage` called once)
  - `arrival replays once and server == C2 with one root client`
  - `arrival with server moved merges` (`REMOTE` survives)
  - `arrival with no provable base keeps both`
  - `refused disk write leaves entry pending and doc untouched`
  - `flush listener does not write S over a pending edit`
  - `local note seeds as before`
  - `live note diffs as before`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement as described.
- [ ] **Step 4:** Run them. Expected: PASS. Then run `bun test tests/crdt`. Expected: PASS. Update fakes for the new opts the way #619 did, adding the fields.
- [ ] **Step 5:** Commit `feat(crdt): single ingest gate in ProviderRegistry`.

### Task 5: SyncEngine inputs

**Files:**
- Modify:
  - `src/sync.ts`: `routeModify`, `reconcileColdStart`, `captureDiskDriftBeforeRemote`, both queued-create ADOPT transfers, genesis fast path, `mergeLocalEditFromBase` fold-in, discovery leg, `adoptHistoryLessNote`'s base lookup
  - `src/crdt/wiring.ts`
- Test: `tests/sync-ingest-inputs.test.ts`, plus carry-overs in Task 9

**Interfaces:**
- Consumes: `registry.ingest`, `IngestResult`.
- Produces, on SyncEngine: `isServerKnown(noteId: string): boolean` (public, fail closed). It replaces `hasServerNote` for the gate only; `hasServerNote` stays for the routing it does today.

**Behaviour:**
- **Every row of the spec's "Inputs mapped to the gate" table becomes `crdt.ingest(...)`.** `{pending}` counts as success: no caller falls back, re-seeds or returns failure for it.
- **Discovery leg:** `discoveryBase.put(noteId, body)` when the note fits under the cap. Replace the in-memory `discoveryBases` with the store, and keep `adoptHistoryLessNote` on the same source.
- **Queued-create transfer:** the mint doc stays alive until the result is `consumed`, and is removed only then.

- [ ] **Step 1: Failing tests:**
  - `discovered note's first edit goes pending, then lands once`
  - `cold-start reconcile of a discovered note goes pending`
  - `rename while pending replays to the new path`
  - `oversized discovered note is not gated or stored`
  - `queued-create transfer keeps the mint doc until consumed`
  - `pending counts as pushed: no REST/seed fallback`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `bun test tests/sync*.test.ts tests/crdt`. Expected: PASS.
- [ ] **Step 5:** Commit `refactor(sync): route every local write through the ingest gate`.

### Task 6: Lineage acquisition, backoff and Sync Center

**Files:**
- Modify: `src/sync.ts`, adding `requestLineage` and the retry loop
- Modify: `src/i18n/locale/*.ts` (the new key), run through `scripts/i18n-translate.ts`
- Test: `tests/sync-lineage-acquire.test.ts`

**Interfaces:**
- Produces:
  - `SyncEngine.requestLineage(noteId: string): void`
  - `SyncEngine.retryPendingLineage(): Promise<void>`, called on rejoin, catch-up end and vault open; concurrency 4

**Behaviour:**
- **Fetch:** `crdt_doc_state`, then `crdt.applyRemoteUpdate` (which fires `onLineage`).
- **Fallback:** if the frame is unsupported or latched, or the port is missing, `crdtEnrollment.enroll(noteId)`.
- **Retry:** the backoff from Global Constraints. Only one timer per note; a request while one is pending does nothing.
- **Sync Center:** the issue at 10 minutes. On replay it is cleared only if the path's current issue carries this key.

- [ ] **Step 1: Failing tests** (`ManualTimeProvider`):
  - `unreachable server: never seeds, retries on backoff, one read per step`
  - `latched frame falls back to enroll, not seed`
  - `pending 10 min shows the Sync Center issue; replay clears only that issue`
  - `rejoin retries every pending note`
  - `offline: no reads attempted`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Then run `bun scripts/i18n-translate.ts` for the new key. It needs Ollama: if it is not reachable from the box, ask cleanup or god to run it, and do not hand-translate.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sync): durable lineage acquisition with backoff and Sync Center surfacing`.

### Task 7: Live binding as an input

**Files:**
- Modify: `src/crdt/live/live-binding.ts`, `src/crdt/live/live-binding-decisions.ts`, `src/crdt/live/live-views.ts` (register `editorText`/`paintEditor`)
- Test: `tests/crdt/live-binding-ingest.test.ts`

**Interfaces:**
- Consumes: `registry.ingest`, and the `editorText`/`paintEditor` opts.

**Behaviour:**
- **`decideReconcile` `defer`:** calls `ingest(noteId, {text: editorText, base: preEditText, source: "editor"})`, then waits for `paintEditor` before `goLive`.
- **Forward and merge writes** (live-binding.ts:202, 316, 322) go through the gate when the doc is history-less. Once `goLive` has run, keystrokes write directly.
- **`ingestFrontmatter`** becomes `ingest` with the full disk text.

- [ ] **Step 1: Failing tests:**
  - `typed during the round trip survives the replay` (type, then `crdt_doc_state` resolves, then the merged text contains both)
  - `bound note, server moved, no base: conflict copy holds the typed text`
  - `frontmatter typed into an awaiting note waits, then lands once`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them, plus `bun test tests/crdt/live`. Expected: PASS.
- [ ] **Step 5:** Commit `refactor(live): binding reports to the ingest gate`.

### Task 8: Upgrade migration

**Files:**
- Create: `src/crdt/ingest-migration.ts`
- Modify: `src/main.ts` (run once at boot, behind `ingestGateVersion`)
- Test: `tests/crdt/ingest-migration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function migrateIngestGate(deps: {
    undeliveredNoteIds(): string[]; serverState(id: string): Promise<Uint8Array | null>;
    localDoc(id: string): Promise<Y.Doc>; pending: PendingIngestStore; writeDisk(id: string, text: string): Promise<boolean>;
    clearDoc(id: string): Promise<void>; crashHook?(step: 1 | 2 | 3): void;
  }): Promise<{ quarantined: string[]; delivered: string[] }>;
  ```

**Behaviour:**
- **Rival** means `rootClients(local) ⊄ rootClients(server)` and the server body is non-empty.
- **Order:** (1) `pending.put({...source: "migration", text: projection})`; (2) `writeDisk` when disk differs, via a conflict copy if disk holds other text; (3) `clearDoc`.
- **`serverState` null (old backend):** skip the check and deliver.
- **Stamp:** `ingestGateVersion = 1` after a full pass; a re-run is idempotent.

- [ ] **Step 1: Failing tests:**
  - `rival undelivered ops are quarantined, never delivered`
  - `legit offline edits on the server lineage deliver`
  - `crash after step N keeps the text on disk or in the entry` (N = 1, 2, 3; restart, then complete)
  - `old backend skips the check`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat(crdt): migrate in-flight rival ops at upgrade`.

### Task 9: Sim scenarios, #619 carry-over, meta-test

**Files:**
- Modify: `tests/sim/model-server.ts` and `tests/sim/replica.ts` (`crdt_doc_state` and the `docState` port; take them from #619 commit b37111c4 if not on main), `tests/sim/scenarios.ts`, `tests/sim/regressions.test.ts`
- Create: `tests/sync-discovered-note-edit-lineage.test.ts` (ported from #619 0e8161d6, adapted to `ingest`), `tests/crdt/seed-helpers-private.test.ts`

**Sim scenarios.** Each asserts the server CONTENT exactly and `rootClients(server) == 1`, not only convergence. The spec's testing list:
- fresh device, closed note (must be red on main);
- editor open;
- server moved during awaiting;
- offline then reconnect;
- restart while pending;
- old backend (no `crdt_doc_state`, converges via the room);
- latched frame;
- queued-create transfer;
- frontmatter-only note;
- **canonicalized-frontmatter row + body edit: no conflict copy** (spec addition (a)).

**Meta-test:** grep `src/` for imports of the four seed helpers outside the allowed files and fail on any hit.

- [ ] **Step 1:** Add the scenarios and the meta-test.
- [ ] **Step 2: Prove red on main.**
  ```
  git worktree add /tmp/claude-1000/-home-open-claw-documents-code-projects-engram-workspace/89b04b3a-c427-47b0-b0c8-35ae23920e88/scratchpad/main-check origin/main
  ```
  Copy in only the sim scenario files, then run `bun test tests/sim/regressions.test.ts -t "fresh device"`. Expected: FAIL (doubled). Record the output for the PR.
- [ ] **Step 3:** On the branch, `bun test tests/sim tests/sync-discovered-note-edit-lineage.test.ts tests/crdt/seed-helpers-private.test.ts`. Expected: PASS.
- [ ] **Step 4:** Commit `test(sim): single-ingest scenarios; red on main`.

### Task 10: PR, review, staging proof

- [ ] **Step 1:** Run every gate from Global Constraints. Push. Open ONE PR whose body:
  - links the spec;
  - lists the Relay deviations (copied from the spec table);
  - says it supersedes #619;
  - includes the red-on-main output.
- [ ] **Step 2: Fresh adversarial review** (one agent, memory-capped). Post it as `ADVERSARIAL REVIEW: <verdict> @ <sha>`, fix in one pass, post the fix SHAs, then a fresh-agent delta check.
- [ ] **Step 3: Ask cleanup for the staging matrix on the head sha:**
  - 10x creator-offline, 10x creator-live, and a bound-editor variant;
  - server == c2 within 5s;
  - main as the control (0/20 expected).
- [ ] **Step 4:** Send god `ready <PR> <sha>` only when the review APPROVEs, CI is green, and staging passes 20/20 on that exact sha. Close #619.

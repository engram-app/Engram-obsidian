# Relay-model CRDT cutover — status + finish map

Branch: `feat/crdt-relay-persistent-stack`. Goal (per Todd): abandon the bespoke
CRDT machine, rebuild the client sync copying Relay's known-good model
(`../relay/Relay/src/client/provider.ts`), full swap.

## Done + green + pushed (this is safe to review as-is)

| Commit | What |
|--------|------|
| `cdadd42` | **Persistent-stack decoupling** — the CRDT stack outlives the socket; `setupNoteStream` no longer destroys the manager on a same-identity reconnect (the root-cause fix for the doubling/wedge). |
| `612944a` | **`NoteProvider`** — faithful port of Relay's provider sync core. Persistent doc, `syncStep1` state-vector diff on reconnect (never a full re-push), `readSyncMessage` convergence (NO text-verify), buffer+flush offline edits. |
| `fbcc765` → `9322845` | **`ProviderRegistry`** — the full engine. One `NoteProvider`+`IndexeddbPersistence` per note; implements the **entire `CrdtManager`/`CrdtEnrollment`/`CrdtChannel` call surface** so it's a structural drop-in. `applyLocalEdit` ports the stale-snapshot guard + adopt-first gate; `closeDoc`/`protect`/`flatten`/`hasPendingGap` are no-ops the persistent doc doesn't need. |
| `70011ae` | **DRY** — `wire.ts` (frame codec) + `note-seed.ts` (disk↔doc seed codec, the #846/#234/test_83 guards) as single sources of truth, shared old↔new. |

6 new TDD tests (2-device in-memory relay: converge / no-doubling-on-reconnect / adopt-first). Full unit suite **2235 green**.

### KEY finding (read before finishing)
Our `channel.ts` already mirrors Relay's exchange (`startSync`=writeSyncStep1,
`handleFrame`=readSyncMessage, `length>1` reply gate). The manager's *bulk* is
**essential disk-integration correctness** (frontmatter, seed-vs-adopt to avoid
#846 doubling, the stale-snapshot guard that prevents deleting remote ops) —
Relay has no equivalent because Relay docs ARE the source of truth; ours mirror
independent disk files. So the registry **keeps that codec** (`note-seed.ts`)
and replaces only the broken sync/lifecycle machinery (churn, full re-push on
mint, text-verify convergence gate, reconnect teardown).

## Remaining to finish the flip (NOT yet done)

1. **`wiring.ts` — swap the engine.** Replace `new CrdtManager` + `new CrdtChannel`
   + `new CrdtEnrollment` with one `new ProviderRegistry({...})`. Map:
   - `deps.sendCrdt` → registry `send`.
   - `onFlushToDisk` (path-resolve + isBound skip + `flushFromCrdt`) → registry `onFlushToDisk`.
   - `isUnchangedSynced`, `docKind`, `onSynced`, `onPersistError` → same opts.
   - `onCrdtMessage(docId,b64)` → `registry.receive(docId,b64)`.
   - `onNoteYjsUpdate(docId,update)` → `registry.applyRemoteUpdate(docId,update)`.
   - `onCrdtDocReady` → `registry.enroll` (+ existing id-map/gate logic kept).
   - `onCrdtNoteNotFound` → unchanged (id-map heal).
   - Return `{ manager: registry, enrollment: registry, onCrdtMessage, ... }`.
   - The `onEmptyStep2` materialize hook: wire via the registry's `onSynced`
     (fires on first syncStep2) + a `text.length===0` check, OR port the
     empty-STEP2 branch into `NoteProvider.receive`.
2. **Types.** `SyncEngine.crdt: CrdtManager` (sync.ts:415) and `CrdtWiring.manager`
   (wiring.ts:63) → `ProviderRegistry`. `CrdtLiveViews` manager param likewise.
   (Structural — the registry has every method these call.)
3. **Delete the convergence gate.** `commitCrdtConvergence` (sync.ts ~3904) — the
   `projected===staged.content` text-verify defer is the permanent-wedge cause and
   is redundant now (the provider converges via `readSyncMessage`). Remove the
   staging/defer; keep the head/syncState bookkeeping to fire on `onSynced`.
4. **Delete** `manager.ts`, `channel.ts`, `enrollment.ts`, the old wiring bits, and
   their now-dead tests (port any codec tests that still apply).
5. **Validate.** Full unit suite + **the E2E suite** (the seed/stale-guard and
   empty-note paths are E2E-only — do not merge without it) + Todd's manual
   file-switch test.

## Parallel blocker (independent of the rewrite)
Todd's plugin **reloads every ~15-30s** in his env (proven: fresh-instance
signature on every socket rebuild; NOT Hot Reload). The Relay model *survives*
it (fresh doc + syncStep1 diff, no doubling) but constant reconnects feel janky.
Tripwire build `b07b100` (diag branch) has warn-level `PLUGIN onload` — one repro
shows whether onload fires every 15s. Find + fix whatever restarts the plugin.

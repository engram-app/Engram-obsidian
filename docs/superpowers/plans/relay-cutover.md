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

## The flip — DONE (commits `f775aff`, `470c2bf`)

1. **`wiring.ts` — engine swapped.** `new CrdtManager` + `new CrdtChannel` +
   `new CrdtEnrollment` collapsed to one `new ProviderRegistry({...})`; the three
   roles aliased (`manager = channel = enrollment = registry`). `onCrdtMessage`
   → `registry.receive`; `onEmptyStep2` wired via the registry's `onSynced` +
   `text.length===0`. ✅
2. **Types.** `SyncEngine.crdt`, `CrdtWiring.manager/channel/enrollment`,
   `CrdtLiveViews` params → `ProviderRegistry`. ✅
3. **Convergence gate deleted.** `commitCrdtConvergence`'s `projected===staged`
   text-verify defer removed — converged (provider syncStep2) now commits the
   staged head/syncState unconditionally. Phantom-binding repair kept. ✅
4. **`setConnected` lifecycle wired (the load-bearing fix).** The Relay provider
   buffers every frame until `setConnected(true)`, which nothing called — so
   enroll was a no-op and edits never sent. Now fired on the crdt: topic join
   (re-advertise via syncStep1 + flush buffered offline edits) and `false` on
   disconnect / join-error, in both `main.ts` and the sim replica. ✅
5. **Old modules deleted** (`manager.ts`, `channel.ts`, `enrollment.ts`); shared
   codec re-exports repointed to `wire.ts` / `frontmatter-codec.ts`. Dedicated
   module tests removed; construction-site tests PORTED (guard coverage kept:
   test_83 stale-snapshot, canvas, seed-gate, create-ack gate). Porting surfaced
   + fixed a real registry bug (rejected room-path flush poisoning pendingFlush)
   and made `hasPendingGap` detect real Yjs pending structs. ✅
6. **Validate.** Unit suite **2171 pass / 0 fail**, src build + biome clean. ⏳
   STILL OWED: **the E2E suite** (seed/stale-guard + empty-note paths are
   E2E-only) + Todd's manual file-switch test. Do NOT merge without E2E green.

## Parallel blocker (independent of the rewrite)
Todd's plugin **reloads every ~15-30s** in his env (proven: fresh-instance
signature on every socket rebuild; NOT Hot Reload). The Relay model *survives*
it (fresh doc + syncStep1 diff, no doubling) but constant reconnects feel janky.
Tripwire build `b07b100` (diag branch) has warn-level `PLUGIN onload` — one repro
shows whether onload fires every 15s. Find + fix whatever restarts the plugin.

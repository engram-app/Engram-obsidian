# Context Doc: First-sync cap retry storm + manifest delete race

_Last verified: 2026-10-17_

## Status
Fixed in PR engram-app/Engram-obsidian#591 (issue #590). Infra resize to 1 vCPU / 2 GiB tracked in engram-infra#1454.

## When to read this
- A Free (or any capped) user first-syncs a vault larger than `notes_cap` and the log fills with `notes_cap_reached`, queue overflow drops, or endless self-heal re-pushes.
- You touch `NotesCapGate`, `CrdtOpQueue`, `SendResult "held"`, or `capBlocksCreate`.
- Notes were trashed as "server-deleted" during a first sync, especially deletes spaced exactly 300 s apart.
- You touch `reconcileFromManifest`, `rowWriteSeq`, or any `syncState` mutator.
- Web/worker CPU spikes during a big first sync and you are about to blame refused creates.

## Incident (2026-10-17 ~01:52-02:25Z)
A Free user (notes_cap 10,000) first-synced a 10k+ note vault from Obsidian desktop. The server ended at 10,046 notes: the backend cap is best-effort. `check_notes_cap` reads `usage_meters` before the increment (backend `notes.ex` ~4078 vs ~792), so concurrent creates overshoot.

## Bug 1: cap retry storm
- Every create past the cap got `notes_cap_reached`. The push catch in `src/sync.ts` enqueued a durable retry for each one.
- `CrdtOpQueue` (MAX_QUEUE 500, MAX_ATTEMPTS 8, TTL 5m) retried each op independently, overflow-dropped, and self-heal re-pushed. ~1,040 refusals and 815 overflow drops logged.
- Fix: `NotesCapGate` in `src/crdt-op-dispatch.ts`. ONE instance, shared by `main.ts` `makeCrdtOpSend` and `SyncEngine.setCrdtPorts({capGate})`.
  - Closes on a `LIMIT_REASONS` reject.
  - Blocks only ROW-ADDING creates: `SyncEngine.capBlocksCreate` = gate closed AND path has no `syncState` row.
  - Queued creates return `SendResult "held"`: not charged an attempt, `enqueuedAt` refreshed, retried after maxBackoff.
  - Reopens on a delete ack or after `NOTES_CAP_HOLD_MS` (10 min). `reset()` on tier change in `applyPlanState`, which also re-runs `selfHealSweep`.
  - Notice (toast + warn log) fires once per reset, because the 5 min self-heal probes forever while over the cap.

## Bug 2: manifest delete race (data loss)
- `reconcileFromManifest`'s delete pass trashed any tracked file absent from the manifest.
- A note whose upload acked while the manifest fetch was in flight is tracked but newer than the snapshot, so it was trashed as "server-deleted".
- Deletes landed exactly 300 s apart (the 5 min fallback catch-up). 15 notes trashed, ~10 never restored (they went to Obsidian trash; server copies kept).
- Fix: a `rowWriteSeq` counter bumped by every `syncState` mutator (`stampSyncedRow`, `patchSyncedRow`, `renamePath`). `catchUp` captures it before `getManifest`; the delete pass skips files whose `rowWrittenAt` > captured seq.
- `rowWrittenAt` is `track(["vault"])`: a repo test requires every engine Map/Set to be tracked.

## Gotchas
- Do NOT gate every `crdt_create` on the cap. A tracked file reaching `crdt_create` is a rename/relocation, which the server never cap-checks (`genesis_relocate_live`). Blocking it drops the rename forever.
- Any new `syncState` mutator MUST bump `rowWriteSeq`, or the manifest race comes back for that write path.
- "held" is not "failed": a held op must not consume `MAX_ATTEMPTS`, or the queue TTL/attempt limit silently drops the user's notes.
- The cap notice must stay once-per-reset; self-heal keeps probing every 5 min while over the cap.

## Correction: the CPU spike was NOT mainly refused creates
- Pyroscope (web): `CrdtChannel.handle_in` ~0.3% of self-CPU. `VaultTreeController` 13.6% (280 `/api/vault/tree` calls, p50 95 ms decrypting 10k paths). Prometheus exporter `format_name` regex ~11% (standing cost). Logger stdout ~5%.
- Worker CPU (85% of 0.5 vCPU) was per-job Postgres round trips + TLS, from ~4 Oban jobs per created note: EmbedNote 412 ms, ExtractNoteLinks 104 ms, NoteCommitted 65 ms, RebindNoteLinks 53 ms.

## Other noise found (not fixed in #591)
- 9,848 `rename-trace 2/3 SKIPPED` lines: the user's own creates echoing back through the pull feed into `applyOp` (`sync.ts` ~8452/8786), with an unconditional `noteIdMap.set` that emits a redundant index frame.
- 4,088 `Index frame refused`: `crdt_index_msg` shares the per-device edit rate limit (240/10s, backend `crdt_channel.ex` `@msg_limit`) with content frames; ~3 index frames per create.
- Upload throughput ~9.4 creates/s, bounded by ~86 ms server `crdt_create` serialized per channel process.

## How to investigate next time
- Loki: `{service_name="engram"} |= "<first 16 chars of HMAC user id>"`.
- Prod read-only DB: engram-infra `docs/context/prod-db-readonly-access.md` (`engram-audit` profile, bastion `i-04243b8cd5dec622e`). `users` has `created_at`/`plan_id`/`free_tier_accepted_at`. `notes` is RLS, so `SET app.current_tenant` per user.
- Count deletes by timestamp: a 300 s cadence points at the fallback catch-up, not the user.

## Tests
- `tests/first-sync-self-heal.test.ts`: "vault over the plan note cap", "catch-up during an upload".
- `tests/crdt-op-wiring.test.ts`: `NotesCapGate` describe.

## References
- PR engram-app/Engram-obsidian#591, issue #590, engram-infra#1454.
- Related: `docs/context/first-sync-delete-push-incident-2026-08-12.md`, `docs/context/crdt-sync-store-hiding-layers.md`.

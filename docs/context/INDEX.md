# Context docs index

One line per doc: the symptom or task that should send you there, then the doc. Add a line here whenever you add a doc to `docs/context/`.

## Plugin internals & ops

- Probing real Obsidian editor behaviour in a throwaway instance (two panes on one file, external modify, when the `ViewPlugin` is constructed, Live Preview CM doc includes frontmatter; running the real live binding as a plugin) -> [obsidian-cdp-binding-probe.md](obsidian-cdp-binding-probe.md)
- Source map, CRDT layer, sync flows, file-type and ignore rules -> [docs/internals.md](../internals.md)
- CDP + Obsidian remote debugging (MCP devtools, evaluate_script) -> [docs/engram-ops.md](../engram-ops.md)
- Code reads `err.json`/`err.text` from a failed `requestUrl` and gets `{}` (default `throw: true` drops the body; tests pass because mocks reject with a body) -> [requesturl-error-body-dropped.md](requesturl-error-body-dropped.md)
- A `bun audit` high on `brace-expansion` that looks already patched (bun's merged advisory range; the fix is a PAIRED `brace-expansion` + `minimatch` override) -> [bun-audit-brace-expansion-false-positive.md](bun-audit-brace-expansion-false-positive.md)
- Version-bump.mjs foot-gun (running it directly drops `version` from `manifest.json`) -> [version-bump-script.md](version-bump-script.md)
- Releases page full of orphaned `-pr.N` / `-rc.N` prereleases, or a closed PR's preview never got deleted (`pull_request: closed` never fires for superseded dependabot PRs; `prereleases.sh` + daily `preview-reconcile.yml`) -> [preview-release-cleanup.md](preview-release-cleanup.md)

## Cross-repo (workspace)

- Server ops, infra, deployment -> workspace repo `docs/deployment.md`
- Backend REST API contract (endpoints, pipelines, auth, config) -> workspace repo `docs/api-contract.md`
- Cross-project debugging workflows (plugin -> backend tracing) -> workspace repo `docs/debugging.md`

## Obsidian API & plugin listing

- Submitting to the Community Plugins directory (Developer Dashboard flow, pricing labels, dashboard listing copy) -> [obsidian-community-submission.md](obsidian-community-submission.md)
- Obsidian mtime quirk (`vault.modify()` sets mtime to "now" : can't use mtime comparison to decide whether to apply a remote change) -> [obsidian-mtime-quirk.md](obsidian-mtime-quirk.md)
- Community-scanner `no-unsafe-*` false-positive flood / outside contributors can't `bun install` (registry-poisoned lockfile; `scripts/check-lockfile-registry.mjs` guard) -> [scanner-type-resolution.md](scanner-type-resolution.md)

## Sync / CRDT architecture & bug classes

- Adding a `Map`/`Set` field to `SyncEngine`, or state survived a vault switch and addressed the new vault with the old vault's ids -> [sync-engine-sweep-registry.md](sync-engine-sweep-registry.md)
- Tempted to build a textual 3-way merge or reach for `BaseStore` (the legacy merge is deleted; `BaseStore` is stale for CRDT notes; where a real LCA still exists) -> [three-way-merge.md](three-way-merge.md)
- Typing while a note loads doubles or reverts after an autosave; the live binding's merge base, the sync engine writing disk into an entering doc, Relay has the same bug, 8 failed approaches, the r6 design + prototype, the CRDT-snapshot open question. READ BEFORE touching the go-live reconcile -> [live-binding-544-investigation.md](live-binding-544-investigation.md)
- Logging layers (`devLog`, `rlog`, the always-on `anomaly()` path and its slug contract, no cleartext paths) -> [logging-architecture.md](logging-architecture.md)
- V8 OOM prevention on large-vault operations (ready gate, content-free queue, push semaphore) -> [v8-oom-prevention.md](v8-oom-prevention.md)
- A first sync trashed freshly pulled files and pushed their deletions (the evidence rule, `engineTrashedPaths`, why the 5s echo TTL is not a safety boundary) -> [first-sync-delete-push-incident-2026-08-12.md](first-sync-delete-push-incident-2026-08-12.md)
- A capped user first-syncs past `notes_cap` (retry storm, `NotesCapGate`, held ops), or a first sync trashed freshly uploaded notes as "server-deleted" 300 s apart (manifest race, `rowWriteSeq`) -> [first-sync-cap-storm-and-manifest-race.md](first-sync-cap-storm-and-manifest-race.md)
- A path-keyed oracle (`hasServerNote`) gating an id-keyed wire, a frame the server drops with `note_not_found`, or `Echo skip` repeating forever -> [path-keyed-oracle-id-keyed-wire.md](path-keyed-oracle-id-keyed-wire.md)
- A web-app rename recreates the file in Obsidian instead of moving it, or live sync dies after a remote rename -> [remote-rename-identity-vs-file.md](remote-rename-identity-vs-file.md)
- The progress modal or recap shows a different number than the preview promised (file units vs op-log rows) -> [sync-progress-units-files-not-ops.md](sync-progress-units-files-not-ops.md)
- A note's server copy holds its old body then the edited body, frontmatter keys doubled, or you are adding a path that writes disk or editor text into a Y.Doc (the load gate: no local input into a server-known doc with no local history; who resolves the held edit) -> [crdt-load-gate.md](crdt-load-gate.md)
- Editor-binding bug classes (note content copied into a DIFFERENT file on file-switch; base deleted when binding to an unseeded doc; typing at the frontmatter boundary dropped) -> [crdt-editor-bind-race-pollution.md](crdt-editor-bind-race-pollution.md)
- Clicking a table cell in Live Preview pastes the whole note into it (any nested `EditorView` inherits the parent owner's `editorInfoField`) -> [live-binding-table-cell-editor.md](live-binding-table-cell-editor.md)
- Adding or reviewing a "hide this locally" Set in `SyncStore` (`evicted`/`forgotten`/`renamedAway`/`deleteSet`), or a note went deaf and re-minted a duplicate id -> [crdt-sync-store-hiding-layers.md](crdt-sync-store-hiding-layers.md)
- A deleted note comes back (or must: safer-delete restore), a stale upsert re-materializes a deleted note, or `Note was destroyed` on a restored id (the seq-fenced tombstone) -> [crdt-tombstone-seq-fence.md](crdt-tombstone-seq-fence.md)
- Missed CRDT delivery healing (catch-up convergence: id adoption parity, base_hash CAS 409, pull backfill, socket vault-catchup via `catchupViaSocket()`) -> [sync-catchup-convergence.md](sync-catchup-convergence.md)
- Prod `auth-failure-burst` alert traced to our own client (`Bearer ` with an empty token logs `reason=no_auth`, not `signature_error`; unlinked installs loop 401s and the log push re-reports them) -> [empty-bearer-no-auth-401-loop.md](empty-bearer-no-auth-401-loop.md)
- Convergence sim tier fidelity gaps and the rule for trusting a sim repro (`tests/sim/`; the differential gate and the seeded random suite both gate; delete/rename are model-blind,) -> [crdt-convergence-sim-fidelity-gaps.md](crdt-convergence-sim-fidelity-gaps.md)
- A new note "never gets created" after a rename+delete at the same name, a create logs `crdt_create ADOPT`, or you are about to drop bookkeeping on a path move (a rename must CARRY the sync-evidence row, not destroy it; plus: the sim shim used to make every delete a no-op) -> [rename-drops-sync-evidence.md](rename-drops-sync-evidence.md)
- A note that logs `re-handshake fired` and then goes silent forever (the create-ack gate swallowing syncStep1; plus how to read `ci-debug` client logs without misordering them) -> [crdt-pull-gated-by-create-ack.md](crdt-pull-gated-by-create-ack.md)
- Touching create-ack bookkeeping, or wondering what actually opens the live-send gate (`setCrdtHead`/`hasServerNote`, NOT `confirmNoteId` : and the ordering `adoptCreateAck` must keep) -> [crdt-pull-gated-by-create-ack.md](crdt-pull-gated-by-create-ack.md)
- Bulk first sync opens a CRDT room per idle (non-editor-open) note, or you are adding an `enroll()` call site (every one must be gated on `isLiveBound`) -> [crdt-pull-gated-by-create-ack.md](crdt-pull-gated-by-create-ack.md)
- About to treat a 0-byte file as "nothing to protect" (three ways an empty file lies: a converged clear, undelivered ops, a `cachedRead` that invented it) -> [crdt-empty-placeholder-cold-rooms.md](crdt-empty-placeholder-cold-rooms.md)
- Wondering why a catch-up leg records no `serverHash`/`seq`, or tempted to add one (a row can lag its own `content_hash`; recording it marks the note in sync at bytes you cannot verify and every later row compares equal and is skipped) -> [crdt-empty-placeholder-cold-rooms.md](crdt-empty-placeholder-cold-rooms.md)
- Closing a note strips its `---` block while the web app still shows the keys, or you are adding ANY path that writes a CRDT doc to disk (`ProviderRegistry.getText` is the body alone : teardown must use `projectedText`/`residentProjection`) -> [crdt-teardown-flush-strips-frontmatter.md](crdt-teardown-flush-strips-frontmatter.md)
- Rapid remote edits end as `Version 35 of 5` on every device, or you are touching `flushFromCrdt` baselines or the discovery write (the `vault.modify` cache window, `flushingHash`/`flushGen`, discovery writes `projectedText` when the doc has history) -> [crdt-flush-echo-read-as-local-edit.md](crdt-flush-echo-read-as-local-edit.md)
- A rename/delete made while sync is gated (`syncBlocked`, or before `setReady`) got lost or duplicated the note; the event-ordered gate journal, why edits are not journaled, and the e2e `setSyncBlocked` replay trap -> [sync-gate-window-journal.md](sync-gate-window-journal.md)
- A note is 0 bytes on every device after being opened, a `flushFromCrdt` guard change, or a flush function returns `true` from a path that wrote nothing (callers stamp synced hashes on `true`; wrong-mint plus silent empty write) -> [empty-write-wipe-538.md](empty-write-wipe-538.md)
- An edit on a just-discovered note lands in a `(conflict <date>).md` copy and the original reverts, or e2e `test_concurrent_edits_both_survive` flakes on the first CRDT test (history-less keep-both; now handled by the disk-drift interlock in `flushFromCrdt`) -> [history-less-drift-keep-both-on-own-base.md](history-less-drift-keep-both-on-own-base.md)

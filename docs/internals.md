## Engram Vault Sync: internals quick reference

_Last verified: 2026-10-03_

Orientation only. Line counts and per-field tables drift, so read the code for specifics (`wc -l src/*.ts`; `FileSyncState` and `EngramSyncSettings` in `src/types.ts`). REST/WebSocket endpoint contracts live in `../engram-workspace/docs/api-contract.md`.

### Source map

| Path | Purpose |
|------|---------|
| `src/main.ts` | Plugin lifecycle, vault event wiring, commands, status bar, CRDT stack setup/teardown |
| `src/sync.ts` | `SyncEngine`: push/pull, `fullSync`, socket catch-up (`catchupViaSocket`, `catchupViaSeqReplay`), manifest reconciliation, debounce, offline queue, drift reconcile, ready gate, push semaphore |
| `src/api.ts` | HTTP client over Obsidian's `requestUrl()` (bypasses CORS, works on mobile) for the remaining REST calls |
| `src/channel.ts` | Native Phoenix v2 WebSocket client (vault-changes topic + CRDT topic, heartbeat, reconnect) |
| `src/crdt/` | The CRDT layer, below |
| `src/crdt-op-queue.ts`, `src/crdt-op-dispatch.ts` | Durable, bounded retry queue for CRDT create/delete/msg ops while the channel is not joined, and its send/error taxonomy |
| `src/offline-queue.ts` | Content-free persistent retry queue for failed sync operations (dedupes by `{vaultId}:{path}`) |
| `src/base-store.ts` | Last-synced note content (`sync-bases.json`); STALE for CRDT notes, see `context/three-way-merge.md` |
| `src/synced-file.ts`, `src/issue-store.ts` | Per-file sync state object; persistent sync failures shown in the Sync Center |
| `src/settings.ts` + `src/tabs/` | Settings UI: Welcome, Connection (Engram Cloud vs Self-hosted, `backend-mode.ts`), Sync Center, Advanced |
| `src/search-*.ts` | Search modal, sidebar view, engine (semantic/keyword/hybrid) |
| `src/remote-log.ts`, `src/dev-log.ts`, `src/diagnostics.ts` | Logging, see `context/logging-architecture.md` |
| `src/i18n/` | UI translation: the English string is the key, 10 locale dictionaries in `locale/`, locale from Obsidian's `getLanguage()` |
| `tests/sim/` | Deterministic N-replica convergence sim (see `tests/sim/README.md`) |

### CRDT layer (`src/crdt/`)

One `Y.Doc` per note, persisted to IndexedDB (`y-indexeddb`) and **keyed by stable `note_id`, not vault path**, so a rename is a metadata change. The client was rebuilt on Relay's model in July 2026 (#331).

- `provider-registry.ts`: `ProviderRegistry`, owns the docs/providers, routes local edits and remote updates, projects docs to file text (`projectedText`, never the body alone, see `context/crdt-teardown-flush-strips-frontmatter.md`). Inbound server bytes carry `REMOTE_ORIGIN` so they flush to disk without re-broadcast.
- `note-provider.ts`: per-doc y-protocols framing (STEP1/STEP2/UPDATE) with a `FrameKind` of `"handshake"` or `"op"`; only ops are subject to the create-before-edit gate (`context/crdt-pull-gated-by-create-ack.md`).
- `wiring.ts`: structural `CrdtWiringDeps` seam so tests wire the CRDT layer without a whole `SyncEngine`.
- `sync-store.ts` / `index-room.ts` / `note-id-map.ts`: the shared per-vault index (`filemeta_v0`) and the path to note_id sidecar. The index wire currently ships off (#1401); local hide-sets must expire (`context/crdt-sync-store-hiding-layers.md`).
- `note-seed.ts`, `bridge.ts`, `lca-merge.ts`: seeding disk into a doc exactly once, adopt-first (never seed a doc another device owns), and delta-relative merge of disk edits.
- `frontmatter-codec.ts`, `canvas-codec.ts`: frontmatter lives in separate shared types apart from the body `Y.Text`; canvas docs are per-element `Y.Map`s.
- `schema.ts`: one-time IndexedDB wipe when upgrading pre-1.10 (proto-1) local docs. `uuid7.ts`: client-mintable, time-ordered note ids.
- `invariants.ts`: runtime invariant checks.
- `live/`: binds an open note's doc to CodeMirror 6 and the reading view. `live-binding.ts` (per-`EditorView` ViewPlugin, 3s drift backstop), `live-binding-decisions.ts` (pure decisions, unit-tested), `live-views.ts` (viewer refcount; suppresses disk writes while a pane holds the note, flushes once on last release), `cm-yjs-bridge.ts`, `reading-view.ts`, `obsidian-internals.ts`.

**Offline durability on iOS/Android** assumes a normal vault stays under the WKWebView per-origin IndexedDB quota (historically ~50 MB, subject to OS eviction). On eviction `onPersistError` logs a warning via `rlog()` and sync continues in memory and over the socket; only local offline durability degrades. Real-device validation was never completed. There is no structural flatten: `flattenIfBloated` is a stub returning false and the syncStep1 diff keeps the wire bounded.

**Cold start:** `reconcileColdStart` runs after `setReady()` for every markdown file and diffs on-disk content into the doc for notes that changed while the app was closed. Only a Y.Doc decode failure fires `onCorruption`; a transient storage write error is swallowed.

### Sync flows worth knowing

- **Catch-up** is socket-native: `catchupViaSocket()` at connect/reconnect and `onLayoutReady` (`context/sync-catchup-convergence.md`). Cursor writes go through `catchupViaSeqReplay` alone.
- **Push:** vault event, `handleModify/Create/Delete/Rename` (suppressed until `setReady()`), per-file debounce (default 2s), then `acquirePushSlot()` (max 5 concurrent). Markdown and canvas ride CRDT ops (`crdt_create` for genesis); attachments use `/attachments` with base64. On failure the path goes to the content-free offline queue; a backoff health check runs while offline and the queue flushes oldest-first on recovery.
- **Echo suppression:** hash-based (`syncState.hash`), plus a short cooldown (`ECHO_COOLDOWN_MS`, 5s) for engine-originated writes. The cooldown is NOT a safety boundary for mass operations (`context/first-sync-delete-push-incident-2026-08-12.md`).
- **Per-engine state** is registered with `this.track([...events], collection)` so teardown cannot forget it (`context/sync-engine-sweep-registry.md`).

### File types and ignore patterns

`src/mime.ts` and `src/file-kind.ts` define what syncs: `.md` and `.canvas` (both CRDT-eligible), plus binary attachments (png jpg jpeg gif bmp svg webp pdf mp3 wav ogg m4a webm flac mp4 mov zip). Always ignored: `.obsidian/` (via `app.vault.configDir`), `.trash/`, `.git/`. User patterns (Advanced tab, one per line): a trailing `/` is a folder pattern (prefix or `/`-contained), otherwise a file pattern (exact or `endsWith("/" + name)`); see `SyncEngine.shouldIgnore`. Per-file *Ignore* from the Sync Center is a separate store (`ignored-files.ts`).

### Time handling

Obsidian `file.stat.mtime` is epoch **milliseconds**; API `mtime` fields are epoch **seconds** (divide by 1000 when sending). `lastSync` / `server_time` are ISO 8601 strings. Obsidian resets mtime on `vault.modify()`, so never decide "already applied" from mtime (`context/obsidian-mtime-quirk.md`).

### Build and test

```bash
bun test              # unit tests (Bun runner)
bun run build         # tsc check + esbuild -> main.js
bun run dev           # esbuild watch mode with sourcemaps
```

Output is `main.js` (CommonJS). Externals: obsidian, electron, @codemirror/*, @lezer/*. Do not bump versions by hand (release-please owns them; `context/version-bump-script.md`).

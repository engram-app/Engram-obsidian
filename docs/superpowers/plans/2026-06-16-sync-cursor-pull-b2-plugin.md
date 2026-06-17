# Sync Cursor Pull — PR B2 (plugin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Obsidian plugin's sync loop from the legacy timestamp feed (`GET /notes/changes?since=` + `GET /attachments/changes?since=`) to the new server-authoritative ordered keyset cursor pull (`GET /sync/changes?cursor=`), with a manifest-authoritative three-way bootstrap that fixes server-deleted-file resurrection.

**Architecture:** The backend (PR B1, merged) exposes one **merged** ordered feed — notes ∪ attachments interleaved by `(seq, id)`, each entry tagged `type: "note" | "attachment"`, tombstones included, opaque `next_cursor`. The plugin holds an opaque cursor (its durably-applied position) and re-applies pages until drained; applies dispatch to the **existing** `applyChange` (notes) / `applyAttachmentChange` (attachments) primitives. A new-or-reset device (no cursor) **bootstraps**: fetch the manifest, run a §F structural reconcile over local files using the existing `syncState` baseline (delete server-deleted, push offline-created), then deliver content via a genesis cursor pull. `X-Device-Id` (a fresh random per-install UUID) attributes the server-side watermark.

**Tech Stack:** TypeScript, esbuild, Bun test runner (`bun test`), Obsidian plugin API. No backend changes (B1 shipped them).

**Spec:** `docs/superpowers/specs/2026-06-16-sync-cursor-pull-design.md` (in the `engram` repo). PR B2 = the "plugin" rollout step. Bootstrap approach = **hybrid** (spec §F structural pass + genesis cursor-pull for content), chosen 2026-06-16.

---

## Background the implementer needs (read before starting)

All paths below are in the plugin repo (`engram-obsidian-sync`, symlinked at `plugin/`).

- **Sync engine:** `src/sync.ts` — class `SyncEngine`. Constructor ~`216`. `pull()` at `1131` (the method you rewrite). `applyChange(change: NoteChange, forceOverwrite = false): Promise<boolean>` at `1706` (handles tombstone→trash, 3-way merge via `baseStore`, write). `applyAttachmentChange(change: AttachmentChange, contentBase64?: string): Promise<boolean>` at `2016` (tombstone→trash; otherwise fetches bytes via `this.api.getAttachment(path)` when `contentBase64` omitted). `pushFile(file, force?)` at `656` (handles both note + binary push). `reconcile()` at `3011` (the legacy manifest diff — do NOT reuse; B2 writes its own §F pass). `private syncState: Map<string, FileSyncState>` at `158`. `baseStore: BaseStore | null` at `169`. Helpers: `isSyncable(file)`, `shouldIgnore(path)`, `isBinaryFile(file)`, `normalizePath` (imported from `obsidian`).
- **API client:** `src/api.ts` — `sendRequest()` at `128` sets headers centrally (`Authorization`, `X-Vault-ID`); `request()` wraps it and **throws** on non-2xx with `.status` on the error. `getChanges(since, opts)` at `247` (legacy notes feed). `getAttachmentChanges(since)` at `378` (legacy attachments feed). `getManifest()` at `350` returns `ManifestResponse | null` (null on 404). `getNote(path)` (per-path note fetch) and `getAttachment(path)` (per-path attachment, returns `{ content_base64 }`) both exist.
- **Types:** `src/types.ts` — `NoteChange` at `82` (`{path,title,content?,content_hash?,folder,tags,mtime,updated_at,deleted,version?}`). `AttachmentChange` at `256` (`{path,mime_type,size_bytes,mtime,updated_at,deleted}`). `ManifestResponse` at `405`, `ManifestEntry` at `272`. `EngramSyncSettings` at `2` (holds `clientId`). `DEFAULT_SETTINGS` at `47`.
- **Plugin entry / persistence:** `src/main.ts` — `interface PluginData` (~`59`) holds `lastSync`, `syncState`, `offlineQueue`, etc. `generateClientId(app)` at `44` (SHA-256 of vault path — **do NOT reuse for device_id**). `loadSettings()` ~`488`. `savePluginData(lastSync, offlineQueue)` ~`511` writes the whole `PluginData`. The `SyncEngine` is constructed here with a `saveData` callback typed `(data: { lastSync: string }) => Promise<void>`.
- **Backend feed entry shape** (what `GET /sync/changes` returns; JSON string keys): a **note** entry is `{type:"note", id, seq, path, title, content, content_hash, folder, tags, mtime, updated_at, deleted, version}`; an **attachment** entry is `{type:"attachment", id, seq, path, mime_type, size_bytes, mtime, updated_at, deleted, version}` (metadata only — **no bytes**). Response: `{changes:[...], next_cursor: string|null, has_more: bool}`. `next_cursor` is present only when `has_more` is true; the cursor token is `base64url("<seq>:<id>")` (url-safe, no padding). Manifest now also returns `change_seq` (integer).
- **Tests:** `tests/sync.test.ts` (~850 lines) is the harness to mirror — it constructs a `SyncEngine` with a mocked `EngramApi` + a fake Obsidian `app`/vault. Study its `beforeEach` + the existing `SyncEngine.pull` suite (~`311`) and `handleStreamEvent` suite (~`723`) for the mocking pattern. Other test files: `tests/three-way-merge.test.ts`, `tests/offline-queue.test.ts`, `tests/base-store.test.ts`. Run: `bun test` (or a single file `bun test tests/sync.test.ts`).

**Out of scope for B2 (flagged, not lost):**
- **Attachment 409-on-stale-version on push** — B1 added the `attachments.version` column + bump but explicitly deferred the *reject-on-stale* enforcement (backend push still accepts). The plugin therefore can't act on attachment 409s yet; this rides a later backend+client change. B2 only *reads* `version` through the feed.
- **`pullAll()`** (manual force-resync, `sync.ts:1311`) stays on the legacy timestamp feed for B2. Migrating it is a follow-up (or PR E). Note it in the PR description.
- **Retiring the legacy feed / `lastSync`** — keep `lastSync` persisted untouched (rollback safety). The legacy `getChanges`/`getAttachmentChanges`/`resolveChangeBody`/`fetchAllNoteChanges` methods stay in the codebase, now unused by `pull()`; PR E removes them.
- **Compaction hardening** — `HISTORY_EXPIRED` floor is 0 (never fires until PR D). B2 ships the 410 handler; PR D will replace the genesis-pull content delivery with manifest-content delivery.

---

## File structure

**Modify:**
- `src/types.ts` — add `SyncNoteChange` / `SyncAttachmentChange` / `SyncChange` (discriminated union) + `SyncChangesResponse`; add `change_seq?: number` to `ManifestResponse`.
- `src/api.ts` — add `deviceId` field + `setDeviceId()`; send `X-Device-Id` header in `sendRequest`; add `getSyncChanges(cursor?, limit?)`.
- `src/cursor.ts` — **Create.** Tiny `encodeCursor(seq, id)` helper (final-page head cursor) — base64url of `"<seq>:<id>"`, matching the backend codec.
- `src/sync.ts` — add `syncCursor` state + getter/setter; widen the `saveData` callback type; add `applySyncChange`, `pullViaCursor`, `bootstrap`, `HistoryExpiredError`; rewrite `pull()`.
- `src/main.ts` — mint + persist `deviceId`; wire `api.setDeviceId`; add `syncCursor` to `PluginData`, load it into the engine, persist it from the widened `saveData` callback.
- `manifest.json` + `package.json` — version bump (one bump for the PR).

**Create (tests):**
- `tests/cursor.test.ts` — `encodeCursor` format/vector.
- `tests/sync-cursor-pull.test.ts` — `getSyncChanges` plumbing, `pullViaCursor` loop, `bootstrap` §F four cases, 410 handling, device_id header. (Or append to `tests/sync.test.ts` if that reuses the harness more cheaply — implementer's call; keep the harness DRY.)

---

### Task 1: `device_id` — mint, persist, send `X-Device-Id`

**Files:** Modify `src/api.ts`, `src/main.ts`. Test: `tests/sync-cursor-pull.test.ts` (device_id header) — or an api-level test.

> `device_id` is a **fresh random per-install UUID**, distinct from `clientId` (which is `sha256(vault path)` and collides across devices on the same path). Stored top-level in `PluginData` (device-local, not a user-facing setting). A reinstall/reset → new id → one clean re-bootstrap.

- [ ] **Step 1: Write the failing test**

In `tests/sync-cursor-pull.test.ts`, mirroring the api/app mock pattern from `tests/sync.test.ts`:
```ts
import { EngramApi } from "../src/api";

describe("X-Device-Id header", () => {
  test("getSyncChanges sends X-Device-Id when set", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    // Stub the module-level requestUrl the api uses (mirror how sync.test.ts stubs it).
    // The contract: after api.setDeviceId("dev-xyz"), the next request carries
    // headers["X-Device-Id"] === "dev-xyz".
    const api = makeApiWithCapturedRequests(calls); // helper in the test harness
    api.setDeviceId("dev-xyz");
    await api.getSyncChanges();
    expect(calls.at(-1)?.headers["X-Device-Id"]).toBe("dev-xyz");
  });

  test("no X-Device-Id header when unset", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const api = makeApiWithCapturedRequests(calls);
    await api.getSyncChanges();
    expect(calls.at(-1)?.headers["X-Device-Id"]).toBeUndefined();
  });
});
```
> The harness helper `makeApiWithCapturedRequests` should construct an `EngramApi` whose underlying `requestUrl` is stubbed to record `{url, headers}` and return `{ status: 200, json: { changes: [], next_cursor: null, has_more: false } }`. Mirror exactly how `tests/sync.test.ts` already stubs `requestUrl`/the api. `getSyncChanges` is added in Task 2 — if executing strictly in order, write this test to also cover an existing method (e.g. a no-op GET) for the header, then extend once Task 2 lands. Keep the assertion contract: header present iff `setDeviceId` was called with a non-empty value.

- [ ] **Step 2: Run — FAIL.** `bun test tests/sync-cursor-pull.test.ts`. Expected: `setDeviceId` undefined / header missing.

- [ ] **Step 3: Add `deviceId` to the API client** — `src/api.ts`.

Add a private field + setter (near the top of the class, beside `vaultId`):
```ts
private deviceId: string | null = null;

/** Set the per-install device id sent as X-Device-Id on cursor pulls. */
setDeviceId(id: string | null): void {
  this.deviceId = id && id.length > 0 ? id : null;
}
```
In `sendRequest` (`~139`), beside the `X-Vault-ID` block:
```ts
if (this.deviceId) {
  headers["X-Device-Id"] = this.deviceId;
}
```

- [ ] **Step 4: Mint + persist `deviceId`** — `src/main.ts`.

Add `deviceId?: string;` to `interface PluginData` (~`59`). In `onload`/startup (after settings load, where `clientId` is ensured), mint if absent and wire it:
```ts
// Per-install device id (random UUID) — distinct from clientId (vault-path hash).
// Sent as X-Device-Id so the backend attributes the sync watermark per device.
const data = (await this.loadData()) as Partial<PluginData> | null;
let deviceId = data?.deviceId;
if (!deviceId) {
  deviceId = crypto.randomUUID();
  await this.saveData({ ...data, deviceId });
}
this.deviceId = deviceId;
this.api.setDeviceId(deviceId);
```
> Reconcile with the exact existing load/save flow in `main.ts` — there is already a `loadData`/`saveData` round-trip for `clientId`; fold `deviceId` into the same pattern so you don't double-write `data.json`. Store `deviceId` on the plugin instance (`private deviceId: string`) and ensure `api.setDeviceId` is called before the first sync.

- [ ] **Step 5: Run — PASS.** `bun test tests/sync-cursor-pull.test.ts`

- [ ] **Step 6: Commit**
```bash
git add src/api.ts src/main.ts tests/sync-cursor-pull.test.ts
git commit -m "feat(sync): mint device_id + send X-Device-Id header"
```

---

### Task 2: Merged-feed types + `api.getSyncChanges`

**Files:** Modify `src/types.ts`, `src/api.ts`. Test: `tests/sync-cursor-pull.test.ts` (append).

- [ ] **Step 1: Append failing test**
```ts
describe("api.getSyncChanges", () => {
  test("builds /sync/changes URL with cursor+limit and parses response", async () => {
    const calls: Array<{ url: string }> = [];
    const api = makeApiWithCapturedRequests(calls, {
      status: 200,
      json: {
        changes: [
          { type: "note", id: "n1", seq: 5, path: "a.md", title: "a", content: "A",
            content_hash: "h", folder: "", tags: [], mtime: 1, updated_at: "t", deleted: false, version: 1 },
          { type: "attachment", id: "a1", seq: 6, path: "p.png", mime_type: "image/png",
            size_bytes: 3, mtime: 1, updated_at: "t", deleted: false, version: 1 },
        ],
        next_cursor: "TOK",
        has_more: true,
      },
    });
    const resp = await api.getSyncChanges("CUR", 2);
    expect(calls.at(-1)?.url).toContain("/sync/changes?");
    expect(calls.at(-1)?.url).toContain("cursor=CUR");
    expect(calls.at(-1)?.url).toContain("limit=2");
    expect(resp.changes).toHaveLength(2);
    expect(resp.changes[0].type).toBe("note");
    expect(resp.changes[1].type).toBe("attachment");
    expect(resp.next_cursor).toBe("TOK");
    expect(resp.has_more).toBe(true);
  });

  test("omits cursor param when absent (genesis pull)", async () => {
    const calls: Array<{ url: string }> = [];
    const api = makeApiWithCapturedRequests(calls, {
      status: 200, json: { changes: [], next_cursor: null, has_more: false },
    });
    await api.getSyncChanges();
    expect(calls.at(-1)?.url).toContain("/sync/changes");
    expect(calls.at(-1)?.url).not.toContain("cursor=");
  });
});
```

- [ ] **Step 2: Run — FAIL** (`getSyncChanges` undefined).

- [ ] **Step 3: Add types** — `src/types.ts`:
```ts
/** A single entry from the ordered cursor feed GET /sync/changes.
 *  Notes carry full content; attachments are metadata-only (bytes fetched
 *  on apply via getAttachment). Both carry the monotonic `seq` and the row
 *  `id` (used to encode the final-page head cursor). */
export interface SyncNoteChange {
  type: "note";
  id: string;
  seq: number;
  path: string;
  title: string;
  content?: string;
  content_hash?: string;
  folder: string;
  tags: string[];
  mtime: number;
  updated_at: string;
  deleted: boolean;
  version?: number;
}

export interface SyncAttachmentChange {
  type: "attachment";
  id: string;
  seq: number;
  path: string;
  mime_type: string;
  size_bytes: number;
  mtime: number;
  updated_at: string;
  deleted: boolean;
  version?: number;
}

export type SyncChange = SyncNoteChange | SyncAttachmentChange;

/** Response from GET /sync/changes (the ordered keyset cursor pull).
 *  next_cursor is the opaque token to resume from; present only when has_more. */
export interface SyncChangesResponse {
  changes: SyncChange[];
  next_cursor: string | null;
  has_more: boolean;
}
```
Also add `change_seq?: number;` to `ManifestResponse` (`~405`) with a comment: `/** Vault's current change_seq (bootstrap watermark; added by backend PR B1). */`.

- [ ] **Step 4: Add `getSyncChanges`** — `src/api.ts` (beside `getChanges`):
```ts
/** Ordered keyset cursor pull (sync backbone). No cursor → server returns
 *  from the start (genesis bootstrap). Throws with status 410 when the cursor
 *  is below the retention floor (HISTORY_EXPIRED; dormant until backend PR D).
 *  Throws 400 on a malformed/tampered token → caller re-bootstraps. */
async getSyncChanges(cursor?: string, limit?: number): Promise<SyncChangesResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit !== undefined) params.set("limit", String(limit));
  const qs = params.toString();
  const resp = await this.request("GET", `/sync/changes${qs ? `?${qs}` : ""}`);
  return resp.json as SyncChangesResponse;
}
```
Import the new types at the top of `api.ts` (`SyncChangesResponse`).

- [ ] **Step 5: Run — PASS.**

- [ ] **Step 6: Commit**
```bash
git add src/types.ts src/api.ts tests/sync-cursor-pull.test.ts
git commit -m "feat(sync): SyncChange types + api.getSyncChanges"
```

---

### Task 3: `encodeCursor` helper (final-page head cursor)

**Files:** Create `src/cursor.ts`. Test: `tests/cursor.test.ts`.

> The backend returns `next_cursor` only while `has_more` is true; on the final page it is `null`. To advance the persisted cursor (and thus the server-side watermark) to the true head after draining, the client encodes the last applied entry's `(seq, id)` itself. The token format is `base64url("<seq>:<id>")`, url-safe, no padding — identical to the backend `Base.url_encode64("<seq>:<id>", padding: false)`.

- [ ] **Step 1: Write the failing test** — `tests/cursor.test.ts`:
```ts
import { encodeCursor } from "../src/cursor";

describe("encodeCursor", () => {
  test("encodes <seq>:<id> as url-safe base64 without padding", () => {
    // Known vector: btoa("42:0a8b...") with +/= → -_ stripped.
    const id = "0a8b1c2d-3e4f-5061-7283-94a5b6c7d8e9";
    const tok = encodeCursor(42, id);
    // round-trip: url-safe base64 decode → "42:<id>"
    const b64 = tok.replace(/-/g, "+").replace(/_/g, "/");
    expect(atob(b64)).toBe(`42:${id}`);
    // url-safe + unpadded invariants
    expect(tok).not.toContain("+");
    expect(tok).not.toContain("/");
    expect(tok).not.toContain("=");
  });

  test("matches the backend format for a fixed vector", () => {
    // Cross-checked against Elixir Base.url_encode64("1:00000000-0000-0000-0000-000000000000", padding: false)
    expect(encodeCursor(1, "00000000-0000-0000-0000-000000000000"))
      .toBe("MTowMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDA");
  });
});
```
> Verify the fixed-vector string by running `Base.url_encode64("1:00000000-0000-0000-0000-000000000000", padding: false)` in `iex` if it doesn't match; correct the expected literal to the backend's actual output. The format invariants (url-safe, unpadded, round-trips to `"<seq>:<id>"`) are the binding contract.

- [ ] **Step 2: Run — FAIL.** `bun test tests/cursor.test.ts`

- [ ] **Step 3: Implement** — `src/cursor.ts`:
```ts
/** Encode an ordered-sync cursor token from (seq, id).
 *  Mirrors the backend codec: base64url of "<seq>:<id>", no padding.
 *  Used only for the final-page head cursor — mid-stream cursors are the
 *  server-issued opaque next_cursor, passed through untouched. */
export function encodeCursor(seq: number, id: string): string {
  return btoa(`${seq}:${id}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**
```bash
git add src/cursor.ts tests/cursor.test.ts
git commit -m "feat(sync): encodeCursor helper (final-page head cursor)"
```

---

### Task 4: Persist `syncCursor`

**Files:** Modify `src/sync.ts`, `src/main.ts`. Test: covered indirectly in Tasks 6–7; add a focused round-trip test here.

> The cursor is the plugin's durably-applied position. New field, **separate** from `lastSync` (which stays untouched for rollback). Persisted in `PluginData.syncCursor`.

- [ ] **Step 1: Write the failing test** — `tests/sync-cursor-pull.test.ts` (append):
```ts
test("syncCursor round-trips through setSyncCursor/getSyncCursor and saveData", async () => {
  const saved: Array<{ lastSync?: string; syncCursor?: string | null }> = [];
  const engine = makeEngine({ saveData: async (d) => { saved.push(d); } }); // harness helper
  engine.setSyncCursor("CUR-1");
  expect(engine.getSyncCursor()).toBe("CUR-1");
  await engine.persistCursor(); // thin wrapper that calls saveData({ syncCursor })
  expect(saved.at(-1)?.syncCursor).toBe("CUR-1");
});
```
> `makeEngine` mirrors the `SyncEngine` construction in `tests/sync.test.ts` (mocked api + app + saveData). If a public `persistCursor` feels like surface bloat, assert the same contract through `pullViaCursor` in Task 6 instead and drop this test — the binding contract is "cursor is held in memory and written via the saveData callback under key `syncCursor`."

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Widen the `saveData` callback + add cursor state** — `src/sync.ts`.

Change the constructor param type from `(data: { lastSync: string }) => Promise<void>` to:
```ts
private saveData: (data: { lastSync?: string; syncCursor?: string | null }) => Promise<void>,
```
Add state + accessors near `lastSync`:
```ts
private syncCursor: string | null = null;

getSyncCursor(): string | null {
  return this.syncCursor;
}

setSyncCursor(cursor: string | null): void {
  this.syncCursor = cursor && cursor.length > 0 ? cursor : null;
}
```
> The legacy `this.saveData({ lastSync: ... })` call in the old `pull()` body still type-checks against the widened signature. (The old `pull()` body is replaced in Task 8 anyway.)

- [ ] **Step 4: Wire persistence** — `src/main.ts`.

Add `syncCursor?: string;` to `interface PluginData`. Where the `SyncEngine` is constructed, update the `saveData` callback so it merges BOTH keys into the persisted `PluginData` (don't clobber `lastSync` when only `syncCursor` is passed, and vice-versa). Load on startup:
```ts
if (saved?.syncCursor) {
  this.syncEngine.setSyncCursor(saved.syncCursor);
}
```
And include `syncCursor: this.syncEngine.getSyncCursor() ?? undefined` in `savePluginData` so a full save (shutdown, etc.) preserves it.
> Concretely: the callback passed to `new SyncEngine(...)` should read the current `PluginData`, apply whichever of `{lastSync, syncCursor}` were provided (treating `syncCursor: null` as "remove the field"), and write back. Mirror how `lastSync` is already merged today.

- [ ] **Step 5: Run — PASS.**

- [ ] **Step 6: Commit**
```bash
git add src/sync.ts src/main.ts tests/sync-cursor-pull.test.ts
git commit -m "feat(sync): persist syncCursor (separate from lastSync)"
```

---

### Task 5: `applySyncChange` — dispatch merged entries to existing apply primitives

**Files:** Modify `src/sync.ts`. Test: `tests/sync-cursor-pull.test.ts` (append).

> Map a merged feed entry to the existing `NoteChange` / `AttachmentChange` shapes and reuse `applyChange` / `applyAttachmentChange` verbatim — they already handle tombstone→trash, 3-way merge, hash-match skip, and binary fetch. Do NOT duplicate apply logic.

- [ ] **Step 1: Append failing test**
```ts
describe("applySyncChange", () => {
  test("note entry → applyChange with mapped NoteChange", async () => {
    const engine = makeEngine();
    const spy = spyOn(engine, "applyChange").mockResolvedValue(true);
    const ok = await engine.applySyncChange({
      type: "note", id: "n1", seq: 5, path: "a.md", title: "a", content: "A",
      content_hash: "h", folder: "", tags: [], mtime: 1, updated_at: "t", deleted: false, version: 2,
    });
    expect(ok).toBe(true);
    const arg = spy.mock.calls[0][0];
    expect(arg).toMatchObject({ path: "a.md", content: "A", version: 2, deleted: false });
    expect((arg as Record<string, unknown>).type).toBeUndefined(); // type/seq stripped
  });

  test("attachment entry → applyAttachmentChange with mapped AttachmentChange", async () => {
    const engine = makeEngine();
    const spy = spyOn(engine, "applyAttachmentChange").mockResolvedValue(true);
    await engine.applySyncChange({
      type: "attachment", id: "a1", seq: 6, path: "p.png", mime_type: "image/png",
      size_bytes: 3, mtime: 1, updated_at: "t", deleted: false, version: 1,
    });
    expect(spy.mock.calls[0][0]).toMatchObject({
      path: "p.png", mime_type: "image/png", size_bytes: 3, deleted: false,
    });
  });
});
```
> `spyOn`/`mockResolvedValue` per Bun's test API (mirror existing spies in `tests/sync.test.ts`). If `applyChange`/`applyAttachmentChange` are not currently `public`, this dispatch (and the loop in Task 6) needs them callable — they are already `async` methods on the class; keep their visibility as-is and make `applySyncChange` a method on the same class so it can call them directly (no visibility change needed).

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — `src/sync.ts`:
```ts
/** Apply one merged cursor-feed entry by dispatching to the existing note /
 *  attachment apply primitives. The feed's `type`/`seq`/`id` are stripped;
 *  applyChange/applyAttachmentChange own tombstone, merge, and skip logic. */
async applySyncChange(c: SyncChange): Promise<boolean> {
  if (c.type === "attachment") {
    const ac: AttachmentChange = {
      path: c.path,
      mime_type: c.mime_type,
      size_bytes: c.size_bytes,
      mtime: c.mtime,
      updated_at: c.updated_at,
      deleted: c.deleted,
    };
    return this.applyAttachmentChange(ac);
  }
  const nc: NoteChange = {
    path: c.path,
    title: c.title,
    content: c.content,
    content_hash: c.content_hash,
    folder: c.folder,
    tags: c.tags,
    mtime: c.mtime,
    updated_at: c.updated_at,
    deleted: c.deleted,
    version: c.version,
  };
  return this.applyChange(nc);
}
```
Import `SyncChange` (and `AttachmentChange`/`NoteChange` if not already) at the top of `sync.ts`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**
```bash
git add src/sync.ts tests/sync-cursor-pull.test.ts
git commit -m "feat(sync): applySyncChange dispatch to note/attachment apply"
```

---

### Task 6: `pullViaCursor` — the keyset pull loop (+ `HistoryExpiredError`)

**Files:** Modify `src/sync.ts`. Test: `tests/sync-cursor-pull.test.ts` (append).

> Loop `getSyncChanges(cursor)`, applying each entry in `(seq,id)` order, persisting the cursor **after** each page (at-least-once; applies are idempotent), until drained. `startCursor === undefined` is the genesis pull (server returns from seq 0). On the final page (`next_cursor` null) advance to the head via `encodeCursor(lastEntry.seq, lastEntry.id)` so the watermark reaches the true tip. A 410 throws `HistoryExpiredError` for the caller to re-bootstrap.

- [ ] **Step 1: Append failing test**
```ts
describe("pullViaCursor", () => {
  test("applies pages in order, advances + persists cursor, resumes, drains", async () => {
    const engine = makeEngine();
    const applied = spyOn(engine, "applySyncChange").mockResolvedValue(true);
    // page 1: 2 entries, has_more; page 2: 1 entry, final (next_cursor null)
    const pages = [
      { changes: [noteEntry(1, "a.md"), attEntry(2, "p.png")], next_cursor: "C1", has_more: true },
      { changes: [noteEntry(3, "b.md")], next_cursor: null, has_more: false },
    ];
    let i = 0;
    spyOn(engine.api, "getSyncChanges").mockImplementation(async () => pages[i++]);
    const n = await engine.pullViaCursor(undefined);
    expect(n).toBe(3);
    expect(applied).toHaveBeenCalledTimes(3);
    // cursor advanced to the head of the final page (encodeCursor(3, id-of-b.md))
    expect(engine.getSyncCursor()).toBe(encodeCursor(3, "id-b.md"));
  });

  test("rethrows 410 as HistoryExpiredError", async () => {
    const engine = makeEngine();
    spyOn(engine.api, "getSyncChanges").mockRejectedValue({ status: 410 });
    await expect(engine.pullViaCursor("CUR")).rejects.toBeInstanceOf(HistoryExpiredError);
  });
});
```
> `noteEntry(seq, path)` / `attEntry(seq, path)` are tiny harness factories returning well-formed `SyncChange` objects with `id: "id-" + path.split('.')[0]` so the head-cursor assertion is deterministic. Expose `engine.api` (or inject the mock) the same way `tests/sync.test.ts` does.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — `src/sync.ts`:
```ts
/** Thrown when the backend returns 410 HISTORY_EXPIRED — the cursor is below
 *  the retention floor (post-compaction). The caller drops the cursor and
 *  re-bootstraps. Dormant until backend PR D turns on compaction. */
export class HistoryExpiredError extends Error {
  constructor() {
    super("history_expired");
    this.name = "HistoryExpiredError";
  }
}
```
```ts
/** Drain the ordered cursor feed from `startCursor` (undefined = genesis).
 *  Applies each entry, persists the cursor after every page, returns the
 *  count applied. Throws HistoryExpiredError on 410. */
private async pullViaCursor(startCursor: string | undefined): Promise<number> {
  let cursor = startCursor;
  let applied = 0;

  for (let page = 0; page < 100_000; page++) {
    let resp: SyncChangesResponse;
    try {
      resp = await this.api.getSyncChanges(cursor, 500);
    } catch (e) {
      if ((e as { status?: number }).status === 410) throw new HistoryExpiredError();
      throw e;
    }

    for (const c of resp.changes) {
      try {
        if (await this.applySyncChange(c)) applied++;
      } catch (e) {
        // Permanent local apply failure (e.g. illegal filename): log + skip,
        // matching legacy pull semantics — one bad entry must not wedge the feed.
        const msg = errMsg(e);
        rlog().error("pull", `Skipped ${c.type} ${c.path} — ${msg}`,
          e instanceof Error ? e.stack : undefined);
      }
    }

    // Advance the persisted cursor to the tip of this page. Mid-stream the
    // server hands back an opaque next_cursor; on the final page it is null,
    // so encode the head from the last applied entry (keeps the watermark
    // moving so PR D compaction can GC).
    if (resp.next_cursor) {
      this.setSyncCursor(resp.next_cursor);
    } else if (resp.changes.length > 0) {
      const last = resp.changes[resp.changes.length - 1];
      this.setSyncCursor(encodeCursor(last.seq, last.id));
    }
    await this.saveData({ syncCursor: this.syncCursor });

    if (!resp.has_more || !resp.next_cursor) break;
    cursor = resp.next_cursor;
  }

  return applied;
}
```
Import `encodeCursor` from `./cursor` and ensure `errMsg`/`rlog` (already used in `sync.ts`) are in scope.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**
```bash
git add src/sync.ts tests/sync-cursor-pull.test.ts
git commit -m "feat(sync): pullViaCursor keyset loop + HistoryExpiredError"
```

---

### Task 7: `bootstrap()` — manifest §F structural pass + genesis pull

**Files:** Modify `src/sync.ts`. Test: `tests/sync-cursor-pull.test.ts` (append).

> No-cursor path. Fetch the manifest, run the §F structural reconcile over local files using the `syncState` baseline (delete server-deleted, push offline-created), then deliver content via a genesis `pullViaCursor(undefined)`. This is the convergence fix: server-deleted files are trashed via the baseline *before* any push, so they can't be resurrected; genuinely-offline-created files (never in baseline) are pushed.

- [ ] **Step 1: Append failing test** — the four §F cases:
```ts
describe("bootstrap (§F reconcile + genesis pull)", () => {
  test("server-deleted (local, !manifest, in baseline) → trashed, not pushed", async () => {
    const engine = makeEngine();
    seedLocalFile(engine, "gone.md", "x");           // exists locally
    engine.seedSyncState("gone.md");                  // in baseline (was synced)
    mockManifest(engine, { notes: [], attachments: [] }); // server no longer has it
    const trash = spyOn(engine.app.fileManager, "trashFile").mockResolvedValue(undefined);
    const push = spyOn(engine, "pushFile").mockResolvedValue(true);
    spyOn(engine.api, "getSyncChanges").mockResolvedValue({ changes: [], next_cursor: null, has_more: false });
    await engine.bootstrap();
    expect(trash).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  test("offline-created (local, !manifest, !baseline) → pushed, not trashed", async () => {
    const engine = makeEngine();
    seedLocalFile(engine, "new.md", "y");             // exists locally
    // NOT in baseline
    mockManifest(engine, { notes: [], attachments: [] });
    const trash = spyOn(engine.app.fileManager, "trashFile").mockResolvedValue(undefined);
    const push = spyOn(engine, "pushFile").mockResolvedValue(true);
    spyOn(engine.api, "getSyncChanges").mockResolvedValue({ changes: [], next_cursor: null, has_more: false });
    await engine.bootstrap();
    expect(push).toHaveBeenCalled();
    expect(trash).not.toHaveBeenCalled();
  });

  test("in-manifest content delivered by the genesis pull (applySyncChange)", async () => {
    const engine = makeEngine();                       // empty local vault
    mockManifest(engine, { notes: [{ path: "a.md", content_hash: "h" }], attachments: [] });
    const apply = spyOn(engine, "applySyncChange").mockResolvedValue(true);
    spyOn(engine.api, "getSyncChanges").mockResolvedValue({
      changes: [noteEntry(1, "a.md")], next_cursor: null, has_more: false,
    });
    await engine.bootstrap();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
```
> Harness helpers (`seedLocalFile`, `seedSyncState`, `mockManifest`) mirror the fake-vault + mocked-api setup already in `tests/sync.test.ts`. The "diverged" case (local + in-manifest, content differs) is exercised by the genesis pull feeding `applySyncChange` → `applyChange`, whose 3-way merge already has dedicated coverage in `tests/three-way-merge.test.ts` and the existing `SyncEngine.pull` conflict tests — don't re-test the merge engine here; just assert the entry reaches `applySyncChange`.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — `src/sync.ts`:
```ts
/** No-cursor bootstrap: manifest-authoritative §F reconcile of LOCAL files
 *  (delete server-deleted, push offline-created — disambiguated by the
 *  syncState baseline), then a genesis cursor pull delivers/refreshes content
 *  (3-way merging diverged files via applyChange). Returns count applied. */
private async bootstrap(): Promise<number> {
  rlog().info("pull", "Bootstrap — manifest reconcile + genesis cursor pull");
  const manifest = await this.api.getManifest();

  // No manifest endpoint (pre-B1 backend) → just genesis-pull; nothing to reconcile.
  if (!manifest) return this.pullViaCursor(undefined);

  const serverPaths = new Set<string>([
    ...manifest.notes.map((n) => normalizePath(n.path)),
    ...manifest.attachments.map((a) => normalizePath(a.path)),
  ]);

  // §F structural pass over local syncable files.
  const toPush: TFile[] = [];
  for (const file of this.app.vault.getFiles()) {
    if (!this.isSyncable(file) || this.shouldIgnore(file.path)) continue;
    const np = normalizePath(file.path);
    if (serverPaths.has(np)) continue; // in manifest → content handled by the pull below

    if (this.syncState.has(np)) {
      // In baseline but gone from the server → server-deleted while away.
      // Trash locally so the genesis pull's push step can't resurrect it.
      await this.app.fileManager.trashFile(file);
      this.syncState.delete(np);
      this.baseStore?.delete(np);
      rlog().info("pull", `Bootstrap: server-deleted → trashed ${file.path}`);
    } else {
      // Never synced → created locally offline → push after content reconcile.
      toPush.push(file);
    }
  }

  // Content delivery: genesis pull (full content + tombstones, ordered).
  const applied = await this.pullViaCursor(undefined);

  // Push offline-created files now that deletes are reconciled.
  for (const file of toPush) {
    try {
      await this.pushFile(file, true);
    } catch (e) {
      rlog().error("pull", `Bootstrap push failed: ${file.path} — ${errMsg(e)}`,
        e instanceof Error ? e.stack : undefined);
    }
  }

  return applied;
}
```
Import `TFile` from `obsidian` (likely already imported).

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit**
```bash
git add src/sync.ts tests/sync-cursor-pull.test.ts
git commit -m "feat(sync): manifest-authoritative bootstrap (§F + genesis pull)"
```

---

### Task 8: Rewrite `pull()` to the cursor flow

**Files:** Modify `src/sync.ts`. Test: `tests/sync-cursor-pull.test.ts` (append) + existing `SyncEngine.pull` suite in `tests/sync.test.ts` must be reconciled.

> Replace the legacy timestamp body of `pull()` (`1131`) with: no cursor → `bootstrap()`; else → `pullViaCursor(cursor)`; on `HistoryExpiredError` → drop the cursor + re-bootstrap. Preserve the existing guards (`syncBlocked`, `pulling` re-entry), `emitStatus`, error capture, and the `finally { flushPostPullPushes() }`. Do NOT touch `lastSync` (kept for rollback). `fullSync()` keeps calling `pull()` unchanged.

- [ ] **Step 1: Append failing test**
```ts
describe("pull() entry", () => {
  test("no cursor → bootstrap", async () => {
    const engine = makeEngine();
    engine.setSyncCursor(null);
    const boot = spyOn(engine as any, "bootstrap").mockResolvedValue(0);
    await engine.pull();
    expect(boot).toHaveBeenCalled();
  });

  test("has cursor → pullViaCursor", async () => {
    const engine = makeEngine();
    engine.setSyncCursor("CUR");
    const inc = spyOn(engine as any, "pullViaCursor").mockResolvedValue(0);
    await engine.pull();
    expect(inc).toHaveBeenCalledWith("CUR");
  });

  test("HistoryExpiredError → clears cursor and re-bootstraps", async () => {
    const engine = makeEngine();
    engine.setSyncCursor("STALE");
    spyOn(engine as any, "pullViaCursor").mockRejectedValueOnce(new HistoryExpiredError());
    const boot = spyOn(engine as any, "bootstrap").mockResolvedValue(0);
    await engine.pull();
    expect(boot).toHaveBeenCalled();
    expect(engine.getSyncCursor()).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Rewrite `pull()`** — replace the body (keep the method signature `async pull(): Promise<number>`):
```ts
async pull(): Promise<number> {
  if (this.syncBlocked) {
    devLog().log("sync-blocked", "pull short-circuited — gate closed");
    return 0;
  }
  if (this.pulling) return 0;
  this.pulling = true;
  this.lastError = "";
  this.emitStatus();
  rlog().info("pull", `Pull started cursor=${this.syncCursor ?? "(bootstrap)"}`);
  try {
    if (!this.syncCursor) {
      return await this.bootstrap();
    }
    try {
      return await this.pullViaCursor(this.syncCursor);
    } catch (e) {
      if (e instanceof HistoryExpiredError) {
        rlog().warn("pull", "HISTORY_EXPIRED — re-bootstrapping");
        this.setSyncCursor(null);
        await this.saveData({ syncCursor: null });
        return await this.bootstrap();
      }
      throw e;
    }
  } catch (e) {
    // biome-ignore lint/suspicious/noConsole: error boundary
    console.error("Engram Sync: pull failed", e);
    rlog().error("pull", `Pull failed: ${errMsg(e)}`, e instanceof Error ? e.stack : undefined);
    this.lastError = e instanceof Error ? `Pull failed: ${e.message}` : "Pull failed";
    return 0;
  } finally {
    this.pulling = false;
    this.emitStatus();
    await this.flushPostPullPushes();
  }
}
```

- [ ] **Step 4: Run — PASS** the new tests. Then run the **existing** suite: `bun test tests/sync.test.ts`. The old `SyncEngine.pull` / `pull (fresh install)` tests assert timestamp-feed behavior (`getChanges`/`getAttachmentChanges`, `lastSync` epoch). Update them to the cursor flow: a fresh engine (`syncCursor` null) now bootstraps (manifest + `getSyncChanges`), an engine with a cursor calls `getSyncChanges(cursor)`. Rewrite those tests to the new contract — do **not** delete coverage; port each assertion (applied count, conflict handling, fresh-install path) to the cursor/bootstrap equivalents. This is expected churn, not scope creep.

- [ ] **Step 5: Run the full suite — PASS.** `bun test`

- [ ] **Step 6: Commit**
```bash
git add src/sync.ts tests/sync.test.ts tests/sync-cursor-pull.test.ts
git commit -m "feat(sync): switch pull() to cursor pull + bootstrap"
```

---

### Task 9: Lints, full suite, version bump

- [ ] **Step 1: Type-check + lints.** Run `bun run build` (tsc + esbuild) and the plugin's CI-only lints (per workspace memory: `lint:obsidian` + `lint:css` + biome). Fix any errors. Expected: clean.
- [ ] **Step 2: Full test suite.** `bun test` — all green. Root-cause any failure (don't skip).
- [ ] **Step 3: Version bump (once for the PR).** `manifest.json` and `package.json`: `1.7.0` → `1.8.0` (minor — new sync mechanism). Keep both files in lockstep.
- [ ] **Step 4: Commit.**
```bash
git add manifest.json package.json
git commit -m "chore: bump plugin version for cursor-pull (PR B2)"
```

---

## Self-review

**Spec coverage (B2 = plugin rollout step):**
- §A `device_id` minted + persisted + `X-Device-Id` header (Task 1) ✅
- §C keyset cursor pull consuming the merged feed (Tasks 2, 5, 6) ✅
- §D pull-carries-ack — satisfied implicitly: the client sends its cursor on each pull and the backend records the watermark from it; the client advances the cursor to the true head even on the final page (Task 6) ✅
- §E bootstrap via manifest + `change_seq`; `HISTORY_EXPIRED`→re-bootstrap (Tasks 7, 8) ✅ (genesis-pull delivers content; `change_seq` field typed in Task 2 — informational for B2, the cursor reaches the head via drain rather than an explicit `(change_seq, MAX_UUID)` jump; noted)
- §F manifest-authoritative three-way reconcile — the four cases: in-manifest→pull (genesis pull), in-both diverged→3-way merge (applyChange), server-deleted→delete-local (baseline trash), offline-created→push (Task 7) ✅
- §G attachment `version` — read through the feed (`SyncAttachmentChange.version`, Task 2); 409-on-push enforcement **deferred** (backend hasn't shipped the reject; flagged) ⚠️ out of scope, documented
- §H coexistence — `lastSync` + legacy methods kept; `pull()` switched; socket path untouched ✅

**Placeholder scan:** No TBD/TODO. Harness helpers (`makeEngine`, `makeApiWithCapturedRequests`, `noteEntry`, `seedLocalFile`, etc.) are named with explicit contracts and told to mirror the existing `tests/sync.test.ts` harness rather than reproduce its ~850-line setup inline — this is deliberate DRY against an existing harness, not a placeholder. The one fixed base64 vector (Task 3) is flagged to verify against `iex` if it mismatches.

**Type consistency:** `SyncChange`/`SyncNoteChange`/`SyncAttachmentChange`/`SyncChangesResponse` defined in Task 2, consumed in Tasks 5–7. `getSyncChanges(cursor?, limit?)` signature consistent across Tasks 2/6/7. `encodeCursor(seq, id)` defined Task 3, used Task 6. `setSyncCursor`/`getSyncCursor`/`syncCursor` + widened `saveData({lastSync?, syncCursor?})` consistent Tasks 4/6/8. `HistoryExpiredError` defined Task 6, caught Task 8. Apply primitives `applyChange(NoteChange)` / `applyAttachmentChange(AttachmentChange)` reused unchanged.

**Deferred (flagged):** attachment 409-on-push (needs backend); `pullAll()` migration; legacy-feed removal (PR E); compaction-era bootstrap content delivery (PR D); explicit `(change_seq, MAX_UUID)` cursor jump (genesis-drain reaches the head without it — simpler, equivalent pre-compaction).

**Pairing note:** the spec calls for an E2E run on a paired backend+plugin branch (two devices converge; offline-across-rename+delete+create reconnects with no duplicate / no resurrection / no lost delete). That E2E lives in `backend/e2e/` and runs via `make e2e` with the `plugin_branch` dispatch input — schedule it once B2 is pushed (see `docs/context/oauth-e2e-pairing-and-token-binding.md`).

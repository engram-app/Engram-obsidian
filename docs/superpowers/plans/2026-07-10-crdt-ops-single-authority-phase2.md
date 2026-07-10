# CRDT-Ops Single-Authority (Phase 2, plugin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Engram Obsidian plugin converge every CRDT-managed note through **Yjs ops only** (channel when live, the new REST `POST /api/notes/:id/updates` flush when the channel is down), and **stop sending the whole-document `base_hash` CAS push for CRDT notes** — collapsing the client-side two-authority seam that causes the false-409 / silent-overwrite bug class (#203, e2e test_83/test_85).

**Architecture:** The per-note Y.Doc (already IndexedDB-persisted) is the single convergence authority. Transport is best-effort: a local edit is applied to the Y.Doc and sent over the `crdt:` channel if live; if the channel is down, a **debounced, idempotent `POST /updates`** of the note's encoded state (`Y.encodeStateAsUpdate`) carries it instead — the backend merges it losslessly onto the canonical server Y.Doc (Phase 1). A CRDT-managed note therefore never takes the whole-doc plaintext push, so there is no `base_hash` CAS to false-409 or blind-overwrite. All of this is **version-gated** behind a capability latch (mirroring `batchPushUnsupported`) so it is inert against a pre-Phase-1 backend, which falls back to today's whole-doc push.

**Tech Stack:** TypeScript, Yjs (`yjs`), esbuild/Bun, vitest (`bun test`), Obsidian API. Backend Phase 1 endpoints (already live on `main`): `POST /api/notes/:id/updates` (body `{update: <base64>}` → `{head}`), `GET /api/notes/:id/updates?since=<url-b64 sv>` → `{update, head}`, `GET /api/vault/heads` → `{heads}`.

## Global Constraints

- **Version-gated, inert by default.** All new send behavior is guarded by a `crdtOpsUnsupported` latch that starts optimistic and latches OFF on the first `404`/`405` from an `/updates` call (mirror `batchPushUnsupported` at `src/sync.ts:4216,4232,4356`). When unsupported, behavior is byte-identical to today (whole-doc push + `base_hash`).
- **Drop `base_hash` ONLY for CRDT-managed notes.** Non-CRDT / legacy / oversized (`> MAX_CRDT_NOTE_BYTES`) notes keep the existing whole-doc `base_hash` CAS push unchanged. The CAS path (`src/sync.ts:1793`, `5392`, `src/api.ts:313`) is removed only on the CRDT branch.
- **Single source of truth for "CRDT-managed."** The predicate currently duplicated inline at `src/sync.ts:1720-1730` and `src/sync.ts:4410-4424` must be extracted to one method and both seams must call it. No behavior change in the extraction.
- **Idempotent, lossless flush.** The REST `/updates` flush sends the note's full encoded Y.Doc state; applying it twice is a no-op server-side. Never send a plaintext body on the CRDT path.
- **base64:** update bytes use standard base64 in the JSON body (reuse `toB64`/`fromB64` from `src/crdt/channel.ts:25-32`); the `since` state vector (Task uses it only in the pull direction, out of this plan's send scope) is url-safe. This plan is send-only; `getUpdates`/`getVaultHeads` are added to the API surface for Phase 3 but only `getVaultHeads` is used here (capability probe).
- **Bun/vitest**, `bun test`. Plugin version bump ONCE when opening the PR (`manifest.json` + `package.json` if versioned there), never again on follow-ups. Signed commits. Before PR: `bun test`, `biome ci` (NOT `check`), `bun run lint:obsidian`, `bun run lint:css`, `bun run build` (tsc typecheck).
- No em dashes in commits / PR body.

---

### Task 1: API client — `postUpdate` / `getUpdates` / `getVaultHeads`

**Files:**
- Modify: `src/api.ts` (add three methods on `EngramApi`, class at `src/api.ts:30`; copy the `request` pattern at `src/api.ts:126` and the `pushNotesBatch` idempotency-header pattern at `src/api.ts:373`)
- Test: `tests/api.test.ts`

**Interfaces:**
- Consumes: `EngramApi.request(method, path, body?, extraHeaders?) :: Promise<RequestUrlResponse>` (`src/api.ts:126`); `toB64(u8: Uint8Array): string` and `fromB64(s: string): Uint8Array` (`src/crdt/channel.ts:25-32` — export them if not already exported).
- Produces:
  - `postUpdate(noteId: string, update: Uint8Array): Promise<{ head: string }>`
  - `getUpdates(noteId: string, since?: string): Promise<{ update: Uint8Array; head: string }>`
  - `getVaultHeads(): Promise<{ heads: Record<string, string> }>`

- [ ] **Step 1: Write the failing test**

In `tests/api.test.ts`, add (adapt to the file's existing mock-fetch harness — mirror how `pushNote`/`pushNotesBatch` tests stub `requestUrl`):

```typescript
describe("crdt ops transport", () => {
  it("postUpdate posts base64 update bytes and returns the head", async () => {
    const calls: any[] = [];
    const api = makeApi((req) => {
      calls.push(req);
      return jsonResponse(200, { head: "h1" });
    });
    const res = await api.postUpdate("note-1", new Uint8Array([1, 2, 3]));
    expect(res.head).toBe("h1");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toContain("/notes/note-1/updates");
    const body = JSON.parse(calls[0].body);
    expect(typeof body.update).toBe("string"); // base64
  });

  it("getVaultHeads returns the note->head map", async () => {
    const api = makeApi(() => jsonResponse(200, { heads: { a: "h1", b: "h2" } }));
    const res = await api.getVaultHeads();
    expect(res.heads).toEqual({ a: "h1", b: "h2" });
  });

  it("getUpdates decodes the base64 delta and returns head", async () => {
    const api = makeApi(() => jsonResponse(200, { update: btoa("\x01\x02"), head: "h3" }));
    const res = await api.getUpdates("note-1", "sv-b64");
    expect(res.update).toBeInstanceOf(Uint8Array);
    expect(res.head).toBe("h3");
  });
});
```

If `tests/api.test.ts` has no `makeApi`/`jsonResponse` helper, reuse whatever request-stub pattern the existing `pushNote` tests use (grep the file first) and match it exactly; do not invent a new harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/api.test.ts`
Expected: FAIL — `api.postUpdate is not a function` (and the other two).

- [ ] **Step 3: Write minimal implementation**

Ensure `toB64`/`fromB64` are exported from `src/crdt/channel.ts` (add `export` if they are module-private), then in `src/api.ts`:

```typescript
  async postUpdate(noteId: string, update: Uint8Array): Promise<{ head: string }> {
    const resp = await this.request(
      "POST",
      `/notes/${encodeURIComponent(noteId)}/updates`,
      { update: toB64(update) },
    );
    return { head: (resp.json as { head: string }).head };
  }

  async getUpdates(noteId: string, since?: string): Promise<{ update: Uint8Array; head: string }> {
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
    const resp = await this.request("GET", `/notes/${encodeURIComponent(noteId)}/updates${qs}`);
    const body = resp.json as { update: string; head: string };
    return { update: fromB64(body.update), head: body.head };
  }

  async getVaultHeads(): Promise<{ heads: Record<string, string> }> {
    const resp = await this.request("GET", `/vault/heads`);
    return { heads: (resp.json as { heads: Record<string, string> }).heads };
  }
```

Add `import { toB64, fromB64 } from "./crdt/channel";` (or wherever they live) at the top of `src/api.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/crdt/channel.ts tests/api.test.ts
git commit -S -m "feat(crdt): API client for /updates + /vault/heads"
```

---

### Task 2: Capability latch — `crdtOpsUnsupported`

**Files:**
- Modify: `src/sync.ts` (add the latch field + helper near `batchPushUnsupported` at `src/sync.ts:4216`)
- Test: `tests/sync-crdt-ops.test.ts` (new)

**Interfaces:**
- Consumes: `EngramApi.postUpdate/getVaultHeads` (Task 1).
- Produces:
  - `private crdtOpsUnsupported = false` field
  - `private crdtOpsAvailable(): boolean` — `this.settings.enableCrdt && !this.crdtOpsUnsupported`
  - `private markCrdtOpsUnsupported(status: number): void` — sets the latch when `status === 404 || status === 405`

- [ ] **Step 1: Write the failing test**

Create `tests/sync-crdt-ops.test.ts` (mirror the harness in `tests/sync-crdt-route.test.ts` for constructing a `SyncEngine` with a mock api + mock crdt):

```typescript
import { describe, it, expect } from "vitest";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// Reuse the route-test harness shape: a SyncEngine with mock app/api/crdt.
function engine(overrides: any = {}) {
  // ... build per tests/sync-crdt-route.test.ts's makeEngine, with settings.enableCrdt = true
}

describe("crdtOpsAvailable latch", () => {
  it("is available when enableCrdt and not latched", () => {
    const e = engine();
    expect((e as any).crdtOpsAvailable()).toBe(true);
  });

  it("latches off on a 404/405 from an updates call", () => {
    const e = engine();
    (e as any).markCrdtOpsUnsupported(404);
    expect((e as any).crdtOpsAvailable()).toBe(false);
  });

  it("stays available on other statuses", () => {
    const e = engine();
    (e as any).markCrdtOpsUnsupported(500);
    expect((e as any).crdtOpsAvailable()).toBe(true);
  });
});
```

Copy `tests/sync-crdt-route.test.ts`'s exact engine-construction helper into this file's `engine()` (do not import a non-exported helper). Set `settings.enableCrdt = true`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: FAIL — `crdtOpsAvailable is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/sync.ts`, near `private batchPushUnsupported = false;` (`src/sync.ts:4216`):

```typescript
  // Version gate: latched OFF the first time an /updates call 404/405s (a
  // pre-Phase-1 backend). While off, CRDT notes fall back to the whole-doc
  // base_hash push, exactly as before this feature. Mirrors batchPushUnsupported.
  private crdtOpsUnsupported = false;

  private crdtOpsAvailable(): boolean {
    return this.settings.enableCrdt === true && !this.crdtOpsUnsupported;
  }

  private markCrdtOpsUnsupported(status: number): void {
    if (status === 404 || status === 405) {
      this.crdtOpsUnsupported = true;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync.ts tests/sync-crdt-ops.test.ts
git commit -S -m "feat(crdt): crdtOps capability latch (version gate)"
```

---

### Task 3: Extract the shared `isCrdtManaged` predicate

**Files:**
- Modify: `src/sync.ts` (extract from `src/sync.ts:1720-1730` and reuse at `src/sync.ts:4410-4424`)
- Test: `tests/sync-crdt-route.test.ts` (existing — assert both seams still route identically)

**Interfaces:**
- Produces: `private isCrdtManaged(path: string, noteId: string | null): boolean` — the single predicate, returning true iff `this.crdt && noteId && this.isNoteConfirmed(noteId) && (this.crdtLive?.() ?? true) && (!this.settings.lazyEnrollment || this.isLiveBound(normalizePath(path)))`.

- [ ] **Step 1: Write the failing test**

In `tests/sync-crdt-route.test.ts`, add a test asserting the extracted predicate matches the pre-refactor truth table (confirmed note + live + (no lazy or live-bound) → true; unconfirmed → false; channel down → false; lazy + not-live-bound → false):

```typescript
it("isCrdtManaged is true only when confirmed + live + (eager or live-bound)", () => {
  const e = engine({ enableCrdt: true });
  (e as any).confirmNoteId("p.md", "id-1");           // confirmed
  (e as any).setCrdtLiveCheck(() => true);            // live
  e.settings.lazyEnrollment = false;
  expect((e as any).isCrdtManaged("p.md", "id-1")).toBe(true);

  (e as any).setCrdtLiveCheck(() => false);           // channel down
  expect((e as any).isCrdtManaged("p.md", "id-1")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/sync-crdt-route.test.ts`
Expected: FAIL — `isCrdtManaged is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add the method to `SyncEngine` (place near the other CRDT helpers around `src/sync.ts:648`):

```typescript
  // Single source of truth for "this note converges via CRDT ops, not the
  // whole-doc push". Previously duplicated inline in pushFile and
  // pushNotesViaBatch; both now call this.
  private isCrdtManaged(path: string, noteId: string | null): boolean {
    return (
      !!this.crdt &&
      !!noteId &&
      this.isNoteConfirmed(noteId) &&
      (this.crdtLive?.() ?? true) &&
      (!this.settings.lazyEnrollment || this.isLiveBound(normalizePath(path)))
    );
  }
```

Then replace the inline conjunction at `src/sync.ts:1720-1730` (in `pushFile`) and the equivalent at `src/sync.ts:4410-4424` (in `pushNotesViaBatch`, which also keeps its `file.stat.size <= MAX_CRDT_NOTE_BYTES` gate alongside the call) with `this.isCrdtManaged(file.path, noteId)`. Preserve the size gate and the existing log lines (`src/sync.ts:1694-1699`, `4422`) exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/sync-crdt-route.test.ts tests/sync-crdt-gate.test.ts`
Expected: PASS (both the new test and the existing routing/gate tests — the extraction is behavior-preserving).

- [ ] **Step 5: Commit**

```bash
git add src/sync.ts tests/sync-crdt-route.test.ts
git commit -S -m "refactor(crdt): extract shared isCrdtManaged predicate"
```

---

### Task 4: REST `/updates` flush when the channel is down

**Files:**
- Modify: `src/sync.ts` (a debounced flush scheduler + the flush method)
- Modify: `src/crdt/manager.ts` (expose `encodeStateAsUpdate` already at `manager.ts:273`; no change unless a getter is missing)
- Test: `tests/sync-crdt-ops.test.ts`

**Interfaces:**
- Consumes: `CrdtManager.encodeStateAsUpdate(path, sv?) :: Promise<Uint8Array>` (`src/crdt/manager.ts:273`); `EngramApi.postUpdate` (Task 1); `crdtOpsAvailable()` / `markCrdtOpsUnsupported` (Task 2); `isCrdtManaged` (Task 3).
- Produces:
  - `private crdtFlushTimers: Map<string, number>` field
  - `scheduleCrdtFlush(path: string, noteId: string): void` — debounced (`this.settings.debounceMs`) scheduler
  - `private async flushCrdtState(path: string, noteId: string): Promise<void>` — encodes the note's Y.Doc state and `postUpdate`s it; on 404/405 calls `markCrdtOpsUnsupported` and does nothing else (caller path will legacy-push next edit).

- [ ] **Step 1: Write the failing test**

In `tests/sync-crdt-ops.test.ts`:

```typescript
describe("channel-down CRDT flush via REST /updates", () => {
  it("flushCrdtState posts the encoded Y.Doc state and never sends plaintext", async () => {
    const posted: Array<{ noteId: string; update: Uint8Array }> = [];
    const api = { postUpdate: async (noteId: string, update: Uint8Array) => { posted.push({ noteId, update }); return { head: "h" }; }, pushNote: async () => { throw new Error("must not whole-doc push a CRDT note"); } };
    const crdt = { encodeStateAsUpdate: async () => new Uint8Array([9, 9, 9]) };
    const e = engine({ enableCrdt: true, api, crdt });
    await (e as any).flushCrdtState("p.md", "id-1");
    expect(posted).toEqual([{ noteId: "id-1", update: new Uint8Array([9, 9, 9]) }]);
  });

  it("flushCrdtState latches ops-unsupported on a 404", async () => {
    const api = { postUpdate: async () => { const err: any = new Error("not found"); err.status = 404; throw err; } };
    const crdt = { encodeStateAsUpdate: async () => new Uint8Array([1]) };
    const e = engine({ enableCrdt: true, api, crdt });
    await (e as any).flushCrdtState("p.md", "id-1");
    expect((e as any).crdtOpsAvailable()).toBe(false);
  });
});
```

Match the error-shape your `EngramApi` throws for non-2xx: if `request` throws an error carrying `.status`, use that (grep `src/api.ts` for how 404/405 surface — the `pushNotesBatch` unsupported path at `src/api.ts:355-359` shows the convention). Adjust the test's thrown error to match that exact shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: FAIL — `flushCrdtState is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/sync.ts`:

```typescript
  private crdtFlushTimers: Map<string, number> = new Map();

  // A CRDT note was edited while the channel is down: the edit is already in
  // the local Y.Doc (IndexedDB-persisted). Debounce-flush the note's full
  // encoded state to the server via REST /updates (idempotent, lossless merge).
  scheduleCrdtFlush(path: string, noteId: string): void {
    const key = normalizePath(path);
    const existing = this.crdtFlushTimers.get(key);
    if (existing !== undefined) clearTimeout(existing);
    const t = window.setTimeout(() => {
      this.crdtFlushTimers.delete(key);
      void this.flushCrdtState(path, noteId);
    }, this.settings.debounceMs);
    this.crdtFlushTimers.set(key, t);
  }

  private async flushCrdtState(path: string, noteId: string): Promise<void> {
    if (!this.crdtOpsAvailable() || !this.crdt) return;
    try {
      const update = await this.crdt.encodeStateAsUpdate(normalizePath(path));
      await this.api.postUpdate(noteId, update);
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status !== undefined) this.markCrdtOpsUnsupported(status);
      // On any flush failure the note stays in the offline path; the next
      // reconnect (channel STEP1) or a later flush re-converges it. No data is
      // lost — the edit is durable in the local Y.Doc.
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync.ts tests/sync-crdt-ops.test.ts
git commit -S -m "feat(crdt): REST /updates flush for channel-down CRDT edits"
```

---

### Task 5: Route CRDT notes off the whole-doc `base_hash` push

**Files:**
- Modify: `src/sync.ts` (`pushFile` at `src/sync.ts:1563`, decision block `1720-1783`, body build `1790-1812`; `pushNotesViaBatch` skip at `4410-4424`)
- Test: `tests/sync-crdt-ops.test.ts`, and confirm `tests/sync-c1-serverhash.test.ts` still passes for NON-CRDT notes

**Interfaces:**
- Consumes: `isCrdtManaged` (Task 3), `crdtOpsAvailable` (Task 2), `scheduleCrdtFlush` (Task 4).

- [ ] **Step 1: Write the failing test**

In `tests/sync-crdt-ops.test.ts`:

```typescript
describe("CRDT notes bypass the whole-doc base_hash push", () => {
  it("a CRDT-managed note with ops available never calls pushNote", async () => {
    let pushNoteCalled = false;
    const api = { pushNote: async () => { pushNoteCalled = true; return { note: { id: "id-1" } }; }, postUpdate: async () => ({ head: "h" }) };
    const crdt = { encodeStateAsUpdate: async () => new Uint8Array([1]), applyLocalEdit: async () => true };
    const e = engine({ enableCrdt: true, api, crdt });
    (e as any).confirmNoteId("p.md", "id-1");
    (e as any).setCrdtLiveCheck(() => false); // channel down -> would have whole-doc pushed before
    // drive a push of the CRDT note
    await (e as any).pushFile(makeTFile("p.md"));
    expect(pushNoteCalled).toBe(false); // routed to CRDT flush, not whole-doc push
  });

  it("a NON-CRDT note still sends base_hash (unchanged)", async () => {
    let sawBaseHash = false;
    const api = { pushNote: async (...args: any[]) => { if (args[5] !== undefined) sawBaseHash = true; return { note: { id: "n" } }; } };
    const e = engine({ enableCrdt: false, api }); // enableCrdt false -> legacy path
    (e as any).importSyncState({ "p.md": { hash: 1, version: 1, serverHash: "sh" } });
    await (e as any).pushFile(makeTFile("p.md"));
    expect(sawBaseHash).toBe(true);
  });
});
```

Adapt `makeTFile` / `pushFile` invocation to the existing route-test harness (grep `tests/sync-crdt-route.test.ts` for how it drives `pushFile`). The point of each assertion: CRDT-managed + ops-available ⇒ no `pushNote`; non-CRDT ⇒ `base_hash` still sent.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: FAIL — the first test fails because `pushFile` currently whole-doc-pushes a CRDT note when the channel is down.

- [ ] **Step 3: Write minimal implementation**

In `pushFile` (`src/sync.ts`), in the CRDT decision block (`1720-1783`): when `this.crdtOpsAvailable() && this.isCrdtManaged(file.path, noteId)` and the note is within `MAX_CRDT_NOTE_BYTES`, do NOT fall through to the whole-doc push. Instead:
- If the channel is live (`this.crdtLive?.()`), the edit already went out as a channel op via the manager's `onUpdate`; return without a REST push.
- If the channel is down, call `this.scheduleCrdtFlush(file.path, noteId)` and return without a REST push (and without a `base_hash`).

Concretely, keep the existing "CRDT consumed it" early-return that exists for the live case, and extend the channel-down branch (currently the fall-through to whole-doc push at `1777-1783`) so that when `crdtOpsAvailable()` it schedules the flush and returns `true` instead of building the `base_hash` body at `1790-1812`. Legacy path (ops unsupported, or non-CRDT, or oversized) is unchanged.

In `pushNotesViaBatch` (`src/sync.ts:4410-4424`): a CRDT-managed note is already skipped from the batch as "crdt-owned"; when `crdtOpsAvailable()` and the channel is down, additionally `scheduleCrdtFlush` for that note so a batch-triggered sync of a cold-but-managed note still converges via ops rather than being silently skipped. Keep the existing skip/log for the ops-unavailable case.

Leave `src/sync.ts:1793` (`const baseHash = existing?.serverHash`) intact for the legacy branch — it is only reached now when the note is NOT CRDT-managed-with-ops.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/sync-crdt-ops.test.ts tests/sync-c1-serverhash.test.ts tests/sync-crdt-route.test.ts`
Expected: PASS. `sync-c1-serverhash` (the CAS-base guard) still passes because it exercises NON-ops or non-CRDT paths; if any of its cases assumed a CRDT note sends `base_hash`, that case encodes the old two-authority behavior and must be updated to the single-authority expectation (a CRDT note with ops available does not send `base_hash`) — update the assertion to the new contract, do NOT loosen it to always-pass. Note any such change in the commit body.

- [ ] **Step 5: Commit**

```bash
git add src/sync.ts tests/sync-crdt-ops.test.ts tests/sync-c1-serverhash.test.ts
git commit -S -m "feat(crdt): CRDT notes converge via ops, drop base_hash push"
```

---

### Task 6: Capability probe wiring + version bump + PR

**Files:**
- Modify: `src/sync.ts` or `src/main.ts` (probe `getVaultHeads` once after connect to pre-latch capability; optional but avoids a first-edit whole-doc push on an old backend)
- Modify: `manifest.json` (+ `package.json` if it carries the version)
- Test: `tests/sync-crdt-ops.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("a getVaultHeads 404 pre-latches ops-unsupported", async () => {
  const api = { getVaultHeads: async () => { const err: any = new Error("nf"); err.status = 404; throw err; } };
  const e = engine({ enableCrdt: true, api });
  await (e as any).probeCrdtOps();
  expect((e as any).crdtOpsAvailable()).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: FAIL — `probeCrdtOps is not a function`.

- [ ] **Step 3: Write minimal implementation**

```typescript
  // One-shot capability probe: a pre-Phase-1 backend 404s /vault/heads, so we
  // latch ops off before the first edit and stay on the legacy whole-doc path.
  async probeCrdtOps(): Promise<void> {
    if (!this.settings.enableCrdt) return;
    try {
      await this.api.getVaultHeads();
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status !== undefined) this.markCrdtOpsUnsupported(status);
    }
  }
```

Call `void this.probeCrdtOps()` once from the existing post-connect / ready path (grep for where `setReady`/`goOnline` or the initial manifest fetch runs, e.g. near `src/sync.ts:5209`), so it runs once per session after auth. Bump the plugin version in `manifest.json` (and `package.json` if versioned there).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/sync-crdt-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gauntlet + commit + PR**

```bash
bun test
bun run lint:obsidian && bun run lint:css
./node_modules/.bin/biome ci .
bun run build
git add -A && git commit -S -m "feat(crdt): capability probe + version bump for CRDT-ops"
```

Open the PR titled `feat(crdt): client CRDT-ops single-authority (Phase 2)`; body links the design spec + Phase 1 backend PR #990; note that behavior is version-gated and inert against pre-Phase-1 backends. Do NOT merge; hand back for review + an e2e run against a Phase-1 backend.

---

## Self-Review

**1. Spec coverage (Phase 2 = "route all CRDT-note edits through Yjs ops (channel when live, REST /updates flush when not); drop the whole-document push + base_hash for CRDT notes; version-gated"):**
- Channel when live → unchanged existing `onUpdate` → `sendUpdateRaw` path (Tasks 3/5 leave it intact, just stop the redundant whole-doc push). ✓
- REST /updates flush when not → Tasks 1 (`postUpdate`) + 4 (`flushCrdtState` + debounced scheduler). ✓
- Drop whole-doc push + base_hash for CRDT notes → Task 5 (only the CRDT-managed-with-ops branch; legacy untouched). ✓
- Version-gated → Task 2 latch + Task 6 probe. ✓
- test_83/85 correct by construction → a CRDT note no longer sends a CAS body, so neither the false-409 nor the blind-overwrite path exists for it (asserted indirectly by Task 5's "never calls pushNote"; the full e2e proof runs against a Phase-1 backend, noted in Task 6). ✓
- Deferred to Phase 3 (noted, not built here): `getUpdates`/`getVaultHeads` *consumption* for cold-note head-index background sync + connection pool + external-disk diff3; retire lazy-enrollment. Task 1 adds the API methods but Phase 2 only *sends*; the pull/receive side is Phase 3. ✓

**2. Placeholder scan:** No TBD/"handle errors"/"similar to". Each code step shows the code. Harness-adaptation notes (reuse the existing test harness in `tests/sync-crdt-route.test.ts` / `tests/api.test.ts`; match the API's thrown-error `.status` shape) are explicit "verify against real code" instructions naming the file, not placeholders — an implementer must confirm the mock shape rather than invent one.

**3. Type consistency:** `postUpdate(noteId, update): {head}`, `getUpdates(noteId, since?): {update, head}`, `getVaultHeads(): {heads}`, `crdtOpsAvailable()/markCrdtOpsUnsupported(status)`, `isCrdtManaged(path, noteId)`, `scheduleCrdtFlush(path, noteId)`, `flushCrdtState(path, noteId)`, `probeCrdtOps()` — names + signatures are consistent between defining task, callers, and Interfaces blocks. base64 helpers `toB64`/`fromB64` sourced from `src/crdt/channel.ts`.

**Scope flag for the reviewer/human:** Task 5 changes the CAS contract for CRDT notes, and `tests/sync-c1-serverhash.test.ts` encodes the *old* two-authority guard. Some of its cases may legitimately need updating to the single-authority expectation (a CRDT note with ops available sends no `base_hash`). That is a real semantic change, not a test loosened to pass — it must be reviewed as such. The non-CRDT / ops-unavailable cases in that file must remain green unchanged.

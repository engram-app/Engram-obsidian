# Plan: Surface frontmatter parse errors in the Sync Center

## Goal

The backend now flags a note as `parse_status: "degraded"` (with a structured
`parse_reason`) when its frontmatter can't be fully parsed. Today the plugin
throws that signal away: a degraded note pushes as `:ok`, the Sync Center clears
any issue for it, and the only place a failure ever shows a reason is a bare
`HTTP {status}` line (`src/sync-center-render.ts:362`). This plan surfaces the
real server reason (`message` + `detail.snippet`) as an actionable "Needs
attention" card, on ALL surfaces that carry it (batch push, single-note read,
`/sync/changes` feed — so a note degraded on another device raises an issue
too), and fires a debounced Obsidian `Notice` on the ok→degraded transition
that opens the note so the user can fix it.

## Architecture

The existing issue model already has everything we need EXCEPT one gap: issues
are only ever minted from a THROWN error (`categorizeError` in
`src/issue-store.ts:116`). A degraded note is not an error — it pushes as `:ok`.
So the new seam is on the SUCCESS paths, not the catch blocks.

Data flow we are adding to:

- `SyncEngine.recordBatchPushOk` (`src/sync.ts:5182`) — clears the issue at
  `:5239`. NEW: after clear, feed `result.parse_status`/`result.parse_reason`
  through a new `recordParseStatus(...)` that re-records a `frontmatter` issue
  when degraded.
- Single-note push success (`src/sync.ts:2389`, `this.issues.clear(file.path)`)
  and its `:conflict` server_note path — same `recordParseStatus` call.
- `SyncEngine.applySyncChange` (`src/sync.ts:3812`) — the ONLY pull path whose
  entries carry `id`; it maps `SyncNoteChange`→`NoteChange` (which drops the
  parse fields, `src/types.ts:130`). NEW: read `c.parse_status`/`c.parse_reason`
  BEFORE the map and call `recordParseStatus`. This is how a note degraded on
  device B raises an issue on device A.
- `recordParseStatus` also owns the debounced transition `Notice`.

The Sync Center already routes `actionable` issues into "Needs attention"
(`renderNeedsAttention`, `src/sync.ts` render at `sync-center-render.ts:237`) and
renders one card per category. Adding a `frontmatter` category + `actionable`
disposition makes the card appear for free. The only render change is the
per-file row (`renderFileRow`, `src/sync-center-render.ts:348`): show
`parseReason.message` + `detail.snippet` in place of / alongside the
`HTTP {status}` line.

Key internals (verified file:line):
- `SyncIssue` type: `src/types.ts:443-457`; `SyncIssueCategory`: `src/types.ts:430-438`.
- `issueDisposition`: `src/issue-store.ts:206`; `remediation`: `src/issue-store.ts:223`.
- `CATEGORY_ORDER`/`CATEGORY_ICON`: `src/sync-center-render.ts:25`/`:36`.
- Render fallback line: `src/sync-center-render.ts:360-365`.
- Batch response type `BatchUpsertResult`: `src/types.ts:505`; `NoteResponse.note`: `src/types.ts:108`; `NoteDetail`: `src/types.ts:337`; `SyncNoteChange`: `src/types.ts:155`; `VersionConflictResponse.server_note`: `src/types.ts:530`.
- Notice-with-clickable-child pattern: `src/limit-toast.ts:27-36`.
- Notice mock (`__noticeCapture`): `tests/__mocks__/obsidian.ts:51-84`.
- Render test harness (FakeEl): `tests/sync-center-render.test.ts:12-70`.
- Sync-engine mock harness: `tests/sync-cold-receive.test.ts:26+`.

## Tech Stack

TypeScript, esbuild, Bun. Tests: `bun test` (Jest-compatible, `bun:test`).
Obsidian plugin API (`Notice`, `Workspace.openLinkText`). No new dependencies.

## Global Constraints

- Branch: `feat/frontmatter-reason-display` (worktree already on it).
- Tests: `bun test` from `plugin/` (or the worktree root). Run the specific file
  while iterating: `bun test tests/issue-store.test.ts`.
- Lints MUST be clean before PR: `./node_modules/.bin/biome ci`,
  `bun run lint:obsidian`, `bun run lint:css`. (`bunx biome` pulls the wrong
  version — use the local binary. Run `biome ci`, not `check`.)
- `manifest.json` version: bump ONCE, at PR-open time only (currently
  `1.12.19`). Never bump on follow-up commits.
- No em dashes in user-facing strings (Notice text, card copy, remediation).
- Match existing `SyncIssue` / render / issue-store patterns exactly; reuse
  `remediation`, `issueDisposition`, `renderFileRow`, the `limit-toast` clickable
  Notice pattern. No new abstractions.
- `parse_reason.detail.snippet` is already length-capped (<=200 chars)
  server-side; do NOT re-truncate. `code` is snake_case on the wire.

---

## Task 1: Issue-model plumbing — types, category, disposition, mapping

Pure model layer. No engine or render wiring yet.

### Files
- Modify `src/types.ts`
- Modify `src/issue-store.ts`
- Modify `tests/issue-store.test.ts`

### Interfaces
- Produces: `ParseReason`, `ParseReasonDetail` (new interfaces in `types.ts`);
  `SyncIssueCategory` gains `"frontmatter"`; `SyncIssue` gains `parseReason?: ParseReason`.
  Response types gain `parse_status?`/`parse_reason?`: `BatchUpsertResult`,
  `NoteResponse["note"]`, `NoteDetail`, `SyncNoteChange`,
  `VersionConflictResponse["server_note"]`.
- Produces: `parseStatusToIssue(parseStatus, parseReason)` in `issue-store.ts`.

### Steps

1. Write failing test — append to `tests/issue-store.test.ts` (import
   `parseStatusToIssue` from `../src/issue-store`):

```ts
import { issueDisposition, parseStatusToIssue, remediation } from "../src/issue-store";

describe("frontmatter parse issues", () => {
	test("frontmatter category is actionable", () => {
		expect(issueDisposition("frontmatter")).toBe("actionable");
	});

	test("remediation copy exists for frontmatter (no em dash)", () => {
		const { title, hint } = remediation("frontmatter");
		expect(title.length).toBeGreaterThan(0);
		expect(hint.length).toBeGreaterThan(0);
		expect(`${title} ${hint}`).not.toContain("—");
	});

	test("parseStatusToIssue returns null when ok", () => {
		expect(parseStatusToIssue("ok", null)).toBeNull();
		expect(parseStatusToIssue(undefined, undefined)).toBeNull();
	});

	test("maps frontmatter_invalid_yaml to frontmatter category with reason", () => {
		const reason = {
			code: "frontmatter_invalid_yaml",
			message: "Frontmatter isn't valid YAML",
			detail: { key: null, line: 2, snippet: "date:YYYY-MM-DD" },
		};
		const got = parseStatusToIssue("degraded", reason);
		expect(got).not.toBeNull();
		expect(got?.category).toBe("frontmatter");
		expect(got?.message).toBe("Frontmatter isn't valid YAML");
		expect(got?.parseReason).toEqual(reason);
	});

	test("maps frontmatter_unparseable_key to frontmatter category", () => {
		const reason = {
			code: "frontmatter_unparseable_key",
			message: "A frontmatter value could not be parsed",
			detail: { key: "tags", line: 3, snippet: "tags: [unclosed" },
		};
		expect(parseStatusToIssue("degraded", reason)?.category).toBe("frontmatter");
	});

	test("maps note_processing_failed to other category (generic failure)", () => {
		const reason = { code: "note_processing_failed", message: "Processing failed", detail: null };
		expect(parseStatusToIssue("degraded", reason)?.category).toBe("other");
	});

	test("degraded with null reason still yields a frontmatter issue", () => {
		const got = parseStatusToIssue("degraded", null);
		expect(got?.category).toBe("frontmatter");
		expect(got?.message.length).toBeGreaterThan(0);
	});
});
```

2. Run `bun test tests/issue-store.test.ts` — expect FAIL (import missing,
   `"frontmatter"` not assignable).

3. Implement in `src/types.ts`:

```ts
/** Structured reason a note's frontmatter failed to parse cleanly. Mirrors the
 *  backend `parse_reason` shape (snake_case on the wire). `snippet` is already
 *  capped <=200 chars server-side. */
export interface ParseReasonDetail {
	key: string | null;
	line: number | null;
	snippet: string;
}
export interface ParseReason {
	code: "frontmatter_invalid_yaml" | "frontmatter_unparseable_key" | "note_processing_failed";
	message: string;
	detail: ParseReasonDetail | null;
}
```

- Add `"frontmatter"` to `SyncIssueCategory` (`src/types.ts:430`), before `"other"`.
- Add `parseReason?: ParseReason;` to `SyncIssue` (`src/types.ts:443`).
- Add `parse_status?: "ok" | "degraded";` and `parse_reason?: ParseReason | null;`
  to: `BatchUpsertResult` (`:505`), `NoteResponse["note"]` (`:109`),
  `NoteDetail` (`:337`), `SyncNoteChange` (`:155`), and
  `VersionConflictResponse["server_note"]` (`:530`).

4. Implement in `src/issue-store.ts`:
   - `issueDisposition` (`:206`): add `case "frontmatter":` to the `actionable`
     group (alongside `too_large`, `auth`, `conflict`).
   - `remediation` (`:223`): add
     ```ts
     case "frontmatter":
     	return {
     		title: "Frontmatter needs a fix",
     		hint: "The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.",
     	};
     ```
   - New exported helper:
     ```ts
     /** Turn a backend parse_status/parse_reason into the fields of a SyncIssue,
      *  or null when the note parsed cleanly. frontmatter_* codes are the
      *  actionable "frontmatter" category; note_processing_failed is a generic
      *  batch failure -> the transient "other" bucket. */
     export function parseStatusToIssue(
     	parseStatus: "ok" | "degraded" | undefined,
     	parseReason: ParseReason | null | undefined,
     ): { category: SyncIssueCategory; message: string; parseReason?: ParseReason } | null {
     	if (parseStatus !== "degraded") return null;
     	const category: SyncIssueCategory =
     		parseReason?.code === "note_processing_failed" ? "other" : "frontmatter";
     	const message = parseReason?.message ?? "Frontmatter could not be parsed";
     	return parseReason ? { category, message, parseReason } : { category, message };
     }
     ```
   - Import `ParseReason` in `issue-store.ts` (extend the `./types` import at `:2`).
   - `isPersistedIssue` (`:277`) needs no change — `parseReason` is optional.

5. Run `bun test tests/issue-store.test.ts` — expect PASS.

6. Commit: `feat: model frontmatter parse-status as a SyncIssue category`.

---

## Task 2: Render the reason (message + snippet) in the Sync Center

Category is `actionable`, so `renderNeedsAttention` already surfaces the card.
Only the per-file row and the ordering/icon tables change.

### Files
- Modify `src/sync-center-render.ts`
- Modify `tests/sync-center-render.test.ts`

### Interfaces
- Consumes: `SyncIssue.parseReason` (from Task 1).

### Steps

1. Write failing test — add to `tests/sync-center-render.test.ts` (reuse the
   existing FakeEl harness + `allText`):

```ts
test("renders frontmatter reason message and snippet, not just HTTP status", () => {
	const root = makeFakeEl("div");
	const issue: SyncIssue = {
		path: "notes/broken.md",
		kind: "note",
		category: "frontmatter",
		message: "Frontmatter isn't valid YAML",
		parseReason: {
			code: "frontmatter_invalid_yaml",
			message: "Frontmatter isn't valid YAML",
			detail: { key: null, line: 2, snippet: "date:YYYY-MM-DD" },
		},
		firstFailedAt: Date.now(),
		lastFailedAt: Date.now(),
		attempts: 1,
	};
	renderSyncCenter(root as unknown as HTMLElement, fakePlugin([issue]), () => {});
	const text = allText(root);
	expect(text).toContain("Frontmatter isn't valid YAML");
	expect(text).toContain("date:YYYY-MM-DD");
});
```
   (Mirror the existing test's `fakePlugin`/`renderSyncCenter` setup already in
   this file; if a `fakePlugin` helper isn't present, copy the plugin stub the
   file's existing "Needs Pro" test uses.)

2. Run `bun test tests/sync-center-render.test.ts` — expect FAIL (snippet text
   absent; row only emits `HTTP {status}`).

3. Implement in `src/sync-center-render.ts`:
   - `CATEGORY_ORDER` (`:25`): insert `"frontmatter"` before `"too_large"`.
   - `CATEGORY_ICON` (`:36`): add `frontmatter: "\u{1F4DD}",` (memo icon; the same
     emoji family already used here).
   - In `renderFileRow` (`:348`), after the meta line (`:365`), when
     `issue.parseReason` is set, render a dedicated reason element so the message
     + snippet read as one line (matching the spec example
     "Frontmatter isn't valid YAML: `date:YYYY-MM-DD`"):
     ```ts
     if (issue.parseReason) {
     	const reason = main.createDiv({ cls: "engram-sync-center-issue-reason" });
     	reason.createSpan({ text: issue.parseReason.message });
     	const snippet = issue.parseReason.detail?.snippet;
     	if (snippet) reason.createEl("code", { text: snippet });
     }
     ```
   - Keep the existing `HTTP {status}` meta line untouched (degraded notes have
     no `status`, so it simply won't render for them).

4. Add a CSS rule in the plugin stylesheet (`styles.css`) for
   `.engram-sync-center-issue-reason` (small muted text, `code` mono). Keep it
   token-driven, no `!important`. Run `bun run lint:css`.

5. Run `bun test tests/sync-center-render.test.ts` — expect PASS.

6. Commit: `feat: render frontmatter parse reason in Sync Center rows`.

---

## Task 3: Wire push success paths (batch + single-note) to record/clear parse issues

Introduces the `recordParseStatus` engine method and calls it from every push
success path. No notice yet (Task 5).

### Files
- Modify `src/sync.ts`
- Add `tests/sync-parse-status.test.ts`

### Interfaces
- Consumes: `parseStatusToIssue` (`src/issue-store.ts`); `BatchUpsertResult`,
  `NoteResponse`, `VersionConflictResponse` (`src/types.ts`).
- Produces: `SyncEngine.recordParseStatus(path, kind, parseStatus, parseReason)`.

### Steps

1. Write failing test — `tests/sync-parse-status.test.ts` (mirror the mock-api
   harness in `tests/sync-cold-receive.test.ts:26+`; make `pushNotesBatch`
   resolve a degraded `:ok` result):

```ts
import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { SyncEngine } from "../src/sync";
// ... build engine via the shared mock harness (copy from sync-cold-receive) ...

test("degraded batch :ok result records a frontmatter issue", () => {
	const engine = makeEngine();
	engine.recordParseStatus("notes/a.md", "note", "degraded", {
		code: "frontmatter_invalid_yaml",
		message: "Frontmatter isn't valid YAML",
		detail: { key: null, line: 2, snippet: "date:YYYY-MM-DD" },
	});
	const issue = engine.issues.get("notes/a.md");
	expect(issue?.category).toBe("frontmatter");
	expect(issue?.parseReason?.detail?.snippet).toBe("date:YYYY-MM-DD");
});

test("ok parse_status clears a prior frontmatter issue for that path", () => {
	const engine = makeEngine();
	engine.recordParseStatus("notes/a.md", "note", "degraded", {
		code: "frontmatter_invalid_yaml", message: "bad", detail: null,
	});
	engine.recordParseStatus("notes/a.md", "note", "ok", null);
	expect(engine.issues.get("notes/a.md")).toBeUndefined();
});

test("ok parse_status leaves a non-frontmatter issue intact", () => {
	const engine = makeEngine();
	engine.issues.record({
		path: "notes/a.md", kind: "note", category: "server",
		message: "500", firstFailedAt: 1, lastFailedAt: 1, attempts: 1,
	});
	engine.recordParseStatus("notes/a.md", "note", "ok", null);
	expect(engine.issues.get("notes/a.md")?.category).toBe("server");
});
```

2. Run `bun test tests/sync-parse-status.test.ts` — expect FAIL
   (`recordParseStatus` undefined).

3. Implement `recordParseStatus` in `src/sync.ts` (place near
   `recordBatchPushOk`, import `parseStatusToIssue` in the `./issue-store`
   import at `src/sync.ts:18`):

```ts
/** Record or clear a note's frontmatter parse issue from a backend
 *  parse_status/parse_reason. Called on every push success + feed apply. When
 *  the note parses cleanly we clear ONLY a prior frontmatter issue for the path
 *  (a real error issue recorded elsewhere must survive). Debounced transition
 *  Notice is wired in Task 5. */
recordParseStatus(
	path: string,
	kind: "note" | "attachment",
	parseStatus: "ok" | "degraded" | undefined,
	parseReason: ParseReason | null | undefined,
): void {
	const mapped = parseStatusToIssue(parseStatus, parseReason);
	if (!mapped) {
		const existing = this.issues.get(path);
		if (existing && (existing.category === "frontmatter" || existing.parseReason)) {
			this.issues.clear(path);
		}
		return;
	}
	const now = Date.now();
	this.issues.record({
		path,
		kind,
		category: mapped.category,
		message: mapped.message,
		parseReason: mapped.parseReason,
		firstFailedAt: now,
		lastFailedAt: now,
		attempts: 1,
	});
}
```

4. Wire the call sites:
   - `recordBatchPushOk` (`src/sync.ts:5182`): after `this.issues.clear(file.path)`
     at `:5239`, add
     `this.recordParseStatus(result.server_path ?? file.path, "note", result.parse_status, result.parse_reason);`
   - Single-note push success (`src/sync.ts:2389`): after
     `this.issues.clear(file.path)`, add a `recordParseStatus` call reading
     `resp.note.parse_status`/`resp.note.parse_reason` (`resp` is the
     `NoteResponse` from `pushNote`; confirm the local variable name in that
     scope around `:2360-2390`).
   - `:conflict` server_note paths: the batch conflict branch
     (`src/sync.ts:4947`) hands off to `pushFile`, whose own success path is
     already covered by the single-note wiring above — no extra call needed. For
     the single-note conflict resolution that adopts `server_note`, add a
     `recordParseStatus(serverNote.path, "note", serverNote.parse_status, serverNote.parse_reason)`
     where the resolved server note is applied (locate via the
     `VersionConflictResponse` consumer in `pushFile`).

5. Run `bun test tests/sync-parse-status.test.ts` — expect PASS. Run full
   `bun test` to confirm no regression in existing push tests.

6. Commit: `feat: record frontmatter parse issues from push responses`.

---

## Task 4: Feed consumption — degraded on another device raises an issue

### Files
- Modify `src/sync.ts` (`applySyncChange`, `:3812`)
- Modify `tests/sync-parse-status.test.ts`

### Interfaces
- Consumes: `SyncNoteChange.parse_status`/`parse_reason` (Task 1);
  `SyncEngine.recordParseStatus` (Task 3).

### Steps

1. Write failing test — add to `tests/sync-parse-status.test.ts`:

```ts
test("applySyncChange records a frontmatter issue from a degraded feed entry", async () => {
	const engine = makeEngine();
	await engine.applySyncChange({
		type: "note",
		id: "id-1",
		seq: 5,
		path: "notes/remote.md",
		title: "remote",
		content: "---\ndate:YYYY-MM-DD\n---\nbody",
		folder: "notes",
		tags: [],
		mtime: 1,
		updated_at: "2026-07-12T00:00:00Z",
		deleted: false,
		parse_status: "degraded",
		parse_reason: {
			code: "frontmatter_invalid_yaml",
			message: "Frontmatter isn't valid YAML",
			detail: { key: null, line: 2, snippet: "date:YYYY-MM-DD" },
		},
	});
	expect(engine.issues.get("notes/remote.md")?.category).toBe("frontmatter");
});
```

2. Run — expect FAIL (issue not recorded from the feed).

3. Implement in `applySyncChange` (`src/sync.ts:3812`): after the folder-marker
   `if (!c.path) return false;` guard (`:3829`) and before/after the
   `NoteChange` mapping (`:3871`), for non-deleted entries call:
   `this.recordParseStatus(c.path, "note", c.parse_status, c.parse_reason);`
   (Read the parse fields off `c` here because the `NoteChange` shape at `:3871`
   deliberately drops them.) Deleted entries (`c.deleted`) skip this — a
   tombstone has no parse status.

4. Run `bun test tests/sync-parse-status.test.ts` — expect PASS. Full `bun test`.

5. Commit: `feat: raise frontmatter issue from degraded /sync/changes entries`.

---

## Task 5: Debounced degraded-transition Notice that opens the note

### Files
- Modify `src/sync.ts` (`recordParseStatus` + new debounce state/flush)
- Modify `tests/sync-parse-status.test.ts`

### Interfaces
- Consumes: `Notice` (already imported `src/sync.ts:4`),
  `app.workspace.openLinkText`.
- Notice mock capture: `__noticeCapture` (`tests/__mocks__/obsidian.ts:51`).

### Steps

1. Write failing test — add to `tests/sync-parse-status.test.ts` (reset
   `__noticeCapture.notices` in a `beforeEach`; use Bun fake timers or a small
   injectable delay — the repo debounces via `window.setTimeout`, cf.
   `src/search-ui.ts:150`):

```ts
import { __noticeCapture } from "./__mocks__/obsidian";

test("fires ONE debounced notice for a burst of degraded transitions", async () => {
	__noticeCapture.notices.length = 0;
	const engine = makeEngine();
	engine.recordParseStatus("notes/a.md", "note", "degraded", {
		code: "frontmatter_invalid_yaml", message: "bad a", detail: null,
	});
	engine.recordParseStatus("notes/b.md", "note", "degraded", {
		code: "frontmatter_invalid_yaml", message: "bad b", detail: null,
	});
	await flushDebounce(); // advance fake timers past the debounce window
	expect(__noticeCapture.notices.length).toBe(1);
	expect(__noticeCapture.notices[0].message).toContain("frontmatter");
});

test("re-recording an already-degraded note does not re-fire the notice", async () => {
	__noticeCapture.notices.length = 0;
	const engine = makeEngine();
	engine.recordParseStatus("notes/a.md", "note", "degraded", {
		code: "frontmatter_invalid_yaml", message: "bad", detail: null,
	});
	await flushDebounce();
	engine.recordParseStatus("notes/a.md", "note", "degraded", {
		code: "frontmatter_invalid_yaml", message: "bad", detail: null,
	});
	await flushDebounce();
	expect(__noticeCapture.notices.length).toBe(1); // only the first transition
});
```

2. Run — expect FAIL (no notice fired).

3. Implement in `src/sync.ts`:
   - Add debounce state: `private degradedNoticeTimer: number | null = null;`
     and `private pendingDegraded = new Set<string>();`
   - In `recordParseStatus`, detect the ok->degraded TRANSITION: capture
     `const wasDegraded = this.issues.get(path)?.category === "frontmatter";`
     BEFORE `this.issues.record(...)`. When `mapped` is set and `!wasDegraded`,
     add `path` to `pendingDegraded` and (re)arm the debounce:
     ```ts
     if (this.degradedNoticeTimer) window.clearTimeout(this.degradedNoticeTimer);
     this.degradedNoticeTimer = window.setTimeout(() => this.flushDegradedNotice(), 1500);
     ```
     (Only mint on transition so repeated degraded pushes stay quiet — matches
     the "re-recording does not re-fire" test.)
   - `flushDegradedNotice()`:
     ```ts
     private flushDegradedNotice(): void {
     	this.degradedNoticeTimer = null;
     	const paths = [...this.pendingDegraded];
     	this.pendingDegraded.clear();
     	if (paths.length === 0) return;
     	if (paths.length === 1) {
     		const path = paths[0];
     		const notice = new Notice(`Engram: frontmatter problem in "${path.split("/").pop()}"`, 10_000);
     		const el = (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
     		const link = el?.createEl("a", { text: "Open note" });
     		link?.addEventListener("click", () => void this.app.workspace.openLinkText(path, ""));
     	} else {
     		new Notice(`Engram: ${paths.length} notes have frontmatter problems. Open Sync Center to fix.`, 10_000);
     	}
     }
     ```
     (Mirrors the clickable-Notice pattern in `src/limit-toast.ts:27-36`; the
     mock captures the created link as a button. No em dashes.)

4. Run `bun test tests/sync-parse-status.test.ts` — expect PASS. Full `bun test`.

5. Run all lints: `./node_modules/.bin/biome ci`, `bun run lint:obsidian`,
   `bun run lint:css`. Fix any findings (no suppressions).

6. Commit: `feat: debounced notice on frontmatter degrade that opens the note`.

---

## PR

Open the PR from `feat/frontmatter-reason-display`. Bump `manifest.json`
`version` 1.12.19 -> next patch ONCE, in the PR-open commit only. Ensure the
full `bun test` suite is green and all three lints clean. PR body: link the
backend contract; note the three consumed surfaces (batch, single-note, feed).

## Open questions / risks to resolve before execution

1. `note_processing_failed` disposition. This plan maps it to the transient
   `other` bucket (it is a generic batch failure, not a frontmatter issue). If
   you want it to also read as actionable "Needs attention", say so and I'll map
   it to `frontmatter` (or a distinct category). LOW risk either way.
2. Notice-open target uses `app.workspace.openLinkText(path, "")` (same as
   `sync-center-render.ts:426` `openFile`). If the note isn't materialized
   locally yet (degraded-on-another-device via the feed, before pull writes the
   file), the link will no-op / miss. Acceptable? The Sync Center row's "Open"
   button already has this same limitation. Flagging so it isn't a surprise.
3. Debounce window (1500 ms) and the "N notes" fan-out copy are guesses — adjust
   to taste. The transition-only guard means a steady-state degraded vault stays
   quiet (fires only when a note newly degrades), which is the intended behavior;
   confirm that matches your expectation vs "remind on every sync".

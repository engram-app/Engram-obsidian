import { describe, expect, it, mock } from "bun:test";
import { MarkdownView as MdView } from "obsidian";
import { CrdtLiveViews, ViewerRefcount } from "../src/crdt/live/live-views";

describe("ViewerRefcount", () => {
	it("isBound true while at least one viewer holds the path", () => {
		const rc = new ViewerRefcount(() => {});
		expect(rc.isBound("a.md")).toBe(false);
		rc.bind("a.md", "v1");
		expect(rc.isBound("a.md")).toBe(true);
		rc.bind("a.md", "v2");
		rc.release("a.md", "v1");
		expect(rc.isBound("a.md")).toBe(true);
		rc.release("a.md", "v2");
		expect(rc.isBound("a.md")).toBe(false);
	});

	it("fires onLastRelease exactly once when the final viewer leaves", () => {
		const onLast = mock((_p: string) => {});
		const rc = new ViewerRefcount(onLast);
		rc.bind("a.md", "v1");
		rc.bind("a.md", "v2");
		rc.release("a.md", "v1");
		expect(onLast).toHaveBeenCalledTimes(0);
		rc.release("a.md", "v2");
		expect(onLast).toHaveBeenCalledTimes(1);
		expect(onLast).toHaveBeenCalledWith("a.md");
	});

	it("bind and release are idempotent per (path, viewId)", () => {
		const onLast = mock((_p: string) => {});
		const rc = new ViewerRefcount(onLast);
		rc.bind("a.md", "v1");
		rc.bind("a.md", "v1"); // dup bind, no double count
		rc.release("a.md", "v1");
		rc.release("a.md", "v1"); // dup release, no double fire
		expect(onLast).toHaveBeenCalledTimes(1);
		expect(rc.isBound("a.md")).toBe(false);
	});

	it("boundPaths returns currently-bound paths and is empty after all releases", () => {
		const rc = new ViewerRefcount(() => {});
		// Initially empty
		expect(rc.boundPaths()).toEqual([]);

		rc.bind("a.md", "v1");
		rc.bind("b.md", "v2");
		const paths = rc.boundPaths();
		expect(paths).toHaveLength(2);
		expect(paths).toContain("a.md");
		expect(paths).toContain("b.md");

		// Release one path completely — it should disappear from boundPaths
		rc.release("a.md", "v1");
		expect(rc.boundPaths()).toEqual(["b.md"]);

		// Release remaining path — back to empty
		rc.release("b.md", "v2");
		expect(rc.boundPaths()).toEqual([]);
	});
});

describe("CrdtLiveViews doc lifecycle (onLastViewerRelease)", () => {
	function makeLiveViews(opts?: {
		flushToDisk?: (path: string, content: string) => Promise<void>;
		getText?: (id: string) => Promise<string>;
	}) {
		const closed: string[] = [];
		const flushed: Array<{ path: string; content: string }> = [];
		const releaseErrors: Array<{ path: string; err: unknown }> = [];
		const manager = {
			getText: opts?.getText ?? (async (id: string) => `text-of-${id}`),
			closeDoc: (id: string) => {
				closed.push(id);
			},
		};
		const lv = new CrdtLiveViews({
			app: {} as never,
			manager: manager as never,
			enrollment: {} as never,
			resolveId: (p: string) => `id:${p}`,
			flushToDisk:
				opts?.flushToDisk ??
				(async (path, content) => {
					flushed.push({ path, content });
				}),
			onReleaseError: (path, err) => {
				releaseErrors.push({ path, err });
			},
		});
		return { lv, closed, flushed, releaseErrors };
	}

	it("flushes but keeps the doc resident when the last viewer releases", async () => {
		const { lv, closed, flushed } = makeLiveViews();
		await (
			lv as unknown as { onLastViewerRelease(p: string): Promise<void> }
		).onLastViewerRelease("a.md");
		expect(flushed).toEqual([{ path: "a.md", content: "text-of-id:a.md" }]);
		// Relay persistent-doc model: the doc is NOT freed on last release (closeDoc
		// is a no-op). It stays resident so the note keeps syncing and re-paints
		// instantly on re-open — no re-hydrate/re-handshake churn.
		expect(closed).toEqual([]);
	});

	it("does NOT free the doc if a viewer re-binds during the flush (re-open race)", async () => {
		let onFlush: () => void = () => {};
		const { lv, closed } = makeLiveViews({
			flushToDisk: async () => {
				onFlush();
			},
		});
		// During the async flush, simulate the note being re-opened: a viewer binds.
		onFlush = () => {
			(lv as unknown as { refcount: ViewerRefcount }).refcount.bind("a.md", "v-reopen");
		};
		await (
			lv as unknown as { onLastViewerRelease(p: string): Promise<void> }
		).onLastViewerRelease("a.md");
		expect(closed).toEqual([]); // re-bound during flush → left resident
	});

	it("a flush failure retains the doc (no free without a successful persist)", async () => {
		const { lv, closed } = makeLiveViews({
			flushToDisk: async () => {
				throw new Error("disk full");
			},
		});
		await expect(
			(
				lv as unknown as { onLastViewerRelease(p: string): Promise<void> }
			).onLastViewerRelease("a.md"),
		).rejects.toThrow("disk full");
		expect(closed).toEqual([]); // never freed — we could not persist
	});

	it("a getText failure neither flushes nor frees", async () => {
		const { lv, closed, flushed } = makeLiveViews({
			getText: async () => {
				throw new Error("no text");
			},
		});
		await expect(
			(
				lv as unknown as { onLastViewerRelease(p: string): Promise<void> }
			).onLastViewerRelease("a.md"),
		).rejects.toThrow("no text");
		expect(flushed).toEqual([]);
		expect(closed).toEqual([]);
	});

	it("surfaces a last-release failure via onReleaseError instead of swallowing it", async () => {
		const { lv, releaseErrors } = makeLiveViews({
			flushToDisk: async () => {
				throw new Error("disk full");
			},
		});
		// Drive it through the real refcount callback (which owns the .catch), not
		// the method directly, to pin the no-swallow wiring.
		const rc = (lv as unknown as { refcount: ViewerRefcount }).refcount;
		rc.bind("a.md", "v1");
		rc.release("a.md", "v1");
		await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget chain settle
		expect(releaseErrors.map((e) => e.path)).toEqual(["a.md"]);
	});
});

// Fix wave 6: headless/unfocused Obsidian (CI) doesn't promptly flush a
// programmatically-updated bound editor buffer to disk, even though the CRDT
// doc itself converges correctly (wave 5) — a remote merge can sit unsaved
// for ~30s. requestSaveForBoundPath is the nudge: the caller (onFlushToDisk's
// isBound skip, via main.ts's onBoundUpdate) requests Obsidian's own save
// pipeline for the bound view, debounced so a burst of deltas coalesces.
describe("CrdtLiveViews.requestSaveForBoundPath (fix wave 6)", () => {
	const DEBOUNCE_WAIT_MS = 350; // > the 300ms production debounce window

	function makeView(path: string): {
		view: InstanceType<typeof MdView>;
		requestSave: ReturnType<typeof mock>;
	} {
		const view = new MdView();
		(view as unknown as { file: { path: string } }).file = { path };
		const requestSave = mock();
		(view as unknown as { requestSave: () => void }).requestSave = requestSave;
		return { view, requestSave };
	}

	function makeLiveViewsWithViews(views: Array<InstanceType<typeof MdView>>) {
		const app = { workspace: { getLeavesOfType: mock(() => views.map((view) => ({ view }))) } };
		const manager = { getText: async (id: string) => `text-of-${id}`, closeDoc: () => {} };
		const lv = new CrdtLiveViews({
			app: app as never,
			manager: manager as never,
			enrollment: {} as never,
			resolveId: (p: string) => `id:${p}`,
			flushToDisk: async () => {},
		});
		return lv;
	}

	it("(a) a remote merge into a bound path calls requestSave once, after the debounce", async () => {
		const { view, requestSave } = makeView("a.md");
		const lv = makeLiveViewsWithViews([view]);
		(lv as unknown as { refcount: ViewerRefcount }).refcount.bind("a.md", "v1");

		lv.requestSaveForBoundPath("a.md");
		expect(requestSave).not.toHaveBeenCalled(); // debounced, not immediate

		await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));
		expect(requestSave).toHaveBeenCalledTimes(1);
	});

	it("(b) three rapid merges into the same bound path coalesce to ONE requestSave call", async () => {
		const { view, requestSave } = makeView("a.md");
		const lv = makeLiveViewsWithViews([view]);
		(lv as unknown as { refcount: ViewerRefcount }).refcount.bind("a.md", "v1");

		lv.requestSaveForBoundPath("a.md");
		lv.requestSaveForBoundPath("a.md");
		lv.requestSaveForBoundPath("a.md");

		await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));
		expect(requestSave).toHaveBeenCalledTimes(1);
	});

	it("(c) an unbound path never calls requestSave", async () => {
		const { view, requestSave } = makeView("a.md");
		const lv = makeLiveViewsWithViews([view]);
		// NOT bound — refcount.bind is never called for "a.md".

		lv.requestSaveForBoundPath("a.md");
		await new Promise((r) => setTimeout(r, DEBOUNCE_WAIT_MS));
		expect(requestSave).not.toHaveBeenCalled();
	});
});

describe("CrdtLiveViews.refresh() coalescing", () => {
	it("skips a duplicate same-microtask refresh(), runs again the next tick", async () => {
		// getLeavesOfType is the first thing refresh() does; count it to see how
		// many rebind passes actually ran. Empty list keeps the pass a no-op.
		const getLeaves = mock(() => [] as Array<{ view: unknown }>);
		const lv = new CrdtLiveViews({
			app: { workspace: { getLeavesOfType: getLeaves } } as never,
			manager: { getText: async () => "", closeDoc: () => {} } as never,
			enrollment: {} as never,
			resolveId: (p: string) => `id:${p}`,
			flushToDisk: async () => {},
		});

		// One file switch fires active-leaf-change + file-open (+ layout-change):
		// three synchronous refresh() calls, one real rebind pass.
		lv.refresh();
		lv.refresh();
		lv.refresh();
		expect(getLeaves.mock.calls.length).toBe(1);

		// The queueMicrotask reset clears the guard, so a genuinely-later refresh
		// (observing new workspace state) is never dropped.
		await new Promise((r) => setTimeout(r, 0));
		lv.refresh();
		expect(getLeaves.mock.calls.length).toBe(2);
	});
});

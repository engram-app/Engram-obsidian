import { describe, expect, it, mock } from "bun:test";
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
	function makeLiveViews(flushToDisk?: (path: string, content: string) => Promise<void>) {
		const closed: string[] = [];
		const flushed: Array<{ path: string; content: string }> = [];
		const manager = {
			getText: async (id: string) => `text-of-${id}`,
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
				flushToDisk ??
				(async (path, content) => {
					flushed.push({ path, content });
				}),
		});
		return { lv, closed, flushed };
	}

	it("flushes then frees the doc when the last viewer releases", async () => {
		const { lv, closed, flushed } = makeLiveViews();
		await (
			lv as unknown as { onLastViewerRelease(p: string): Promise<void> }
		).onLastViewerRelease("a.md");
		expect(flushed).toEqual([{ path: "a.md", content: "text-of-id:a.md" }]);
		expect(closed).toEqual(["id:a.md"]); // doc freed after the final flush
	});

	it("does NOT free the doc if a viewer re-binds during the flush (re-open race)", async () => {
		let onFlush: () => void = () => {};
		const { lv, closed } = makeLiveViews(async () => {
			onFlush();
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
});

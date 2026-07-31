import { describe, expect, test } from "bun:test";

// DEV_MODE is a bare global that esbuild replaces at build time. Set it before
// importing so the `trackPromise` gate takes its dev-build branch (mirrors
// tests/dev-log.test.ts).
(globalThis as unknown as { DEV_MODE: boolean }).DEV_MODE = true;

const { PromiseTracker, setActiveTracker, trackPromise } = await import("../src/track-promise");

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("PromiseTracker", () => {
	test("passes the promise through untouched", async () => {
		const tracker = new PromiseTracker();

		await expect(tracker.track("a", Promise.resolve(42))).resolves.toBe(42);
	});

	test("lists a promise that has not settled", () => {
		const tracker = new PromiseTracker();
		tracker.track("slow-pull", new Promise(() => {}));

		expect(tracker.pending().map((p) => p.label)).toEqual(["slow-pull"]);
	});

	test("drops a fulfilled promise from pending and records it as completed", async () => {
		const tracker = new PromiseTracker();
		tracker.track("push", Promise.resolve("ok"));
		await settle();

		expect(tracker.pending()).toHaveLength(0);
		expect(tracker.recent().at(-1)).toMatchObject({ label: "push", state: "fulfilled" });
	});

	test("records a rejection without turning it into an unhandled rejection", async () => {
		const tracker = new PromiseTracker();
		const p = tracker.track("flush", Promise.reject(new Error("nope")));
		// The caller still owns the rejection — tracking must not swallow it.
		await expect(p).rejects.toThrow("nope");

		expect(tracker.recent().at(-1)).toMatchObject({ label: "flush", state: "rejected" });
	});

	test("a rejected tracked promise nobody awaits does not crash the tracker", async () => {
		const tracker = new PromiseTracker();
		tracker.track("fire-and-forget", Promise.reject(new Error("boom")));
		await settle();

		expect(tracker.pending()).toHaveLength(0);
	});

	test("reports how long a pending promise has been outstanding", async () => {
		let now = 1_000;
		const tracker = new PromiseTracker({ now: () => now });
		tracker.track("stuck", new Promise(() => {}));
		now = 4_500;

		expect(tracker.pending()[0].ageMs).toBe(3_500);
	});

	test("bounds the completion ring so a long session cannot grow it without limit", async () => {
		const tracker = new PromiseTracker({ capacity: 3 });
		for (let i = 0; i < 10; i++) tracker.track(`op-${i}`, Promise.resolve(i));
		await settle();

		const recent = tracker.recent();
		expect(recent).toHaveLength(3);
		expect(recent.map((r) => r.label)).toEqual(["op-7", "op-8", "op-9"]);
	});

	test("destroy clears pending entries", async () => {
		const tracker = new PromiseTracker();
		tracker.track("a", new Promise(() => {}));
		tracker.destroy();

		expect(tracker.pending()).toHaveLength(0);
	});

	test("a promise settling after destroy does not repopulate the tracker", async () => {
		const tracker = new PromiseTracker();
		let resolve!: (v: string) => void;
		tracker.track("late", new Promise<string>((r) => (resolve = r)));
		tracker.destroy();
		resolve("done");
		await settle();

		expect(tracker.pending()).toHaveLength(0);
		expect(tracker.recent()).toHaveLength(0);
	});
});

describe("trackPromise", () => {
	test("routes to the installed tracker", async () => {
		const tracker = new PromiseTracker();
		setActiveTracker(tracker);
		try {
			trackPromise("wired", new Promise(() => {}));

			expect(tracker.pending().map((p) => p.label)).toEqual(["wired"]);
		} finally {
			setActiveTracker(null);
		}
	});

	test("is a pass-through when no tracker is installed", async () => {
		setActiveTracker(null);

		await expect(trackPromise("orphan", Promise.resolve(7))).resolves.toBe(7);
	});

	test("does not swallow a rejection", async () => {
		const tracker = new PromiseTracker();
		setActiveTracker(tracker);
		try {
			await expect(trackPromise("bad", Promise.reject(new Error("x")))).rejects.toThrow("x");
		} finally {
			setActiveTracker(null);
		}
	});
});

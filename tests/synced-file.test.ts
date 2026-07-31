import { describe, expect, test } from "bun:test";
import { SyncedFileTable } from "../src/synced-file";

/** Controllable clock so TTL expiry is asserted, not slept through. */
function fakeTime() {
	let next = 1;
	const timers = new Map<number, () => void>();
	return {
		setTimeout(cb: () => void): number {
			const id = next++;
			timers.set(id, cb);
			return id;
		},
		clearTimeout(id: number): void {
			timers.delete(id);
		},
		fire(id: number): void {
			const cb = timers.get(id);
			timers.delete(id);
			cb?.();
		},
		fireAll(): void {
			for (const id of [...timers.keys()]) this.fire(id);
		},
		/** Fire only the earliest-armed timer. Needed where firing everything
		 *  would also expire the marker under assertion. */
		fireOldest(): void {
			const [id] = timers.keys();
			if (id !== undefined) this.fire(id);
		},
		get live(): number {
			return timers.size;
		},
	};
}

describe("SyncedFileTable markers", () => {
	test("a marked path reads back as marked", () => {
		const time = fakeTime();
		const t = new SyncedFileTable(time);
		t.mark("a.md", "pushed", 100);

		expect(t.has("a.md", "pushed")).toBe(true);
	});

	test("markers are independent of each other", () => {
		const time = fakeTime();
		const t = new SyncedFileTable(time);
		t.mark("a.md", "pushed", 100);

		expect(t.has("a.md", "flushed")).toBe(false);
	});

	test("a marker clears when its timer fires", () => {
		const time = fakeTime();
		const t = new SyncedFileTable(time);
		t.mark("a.md", "pushed", 100);
		time.fireAll();

		expect(t.has("a.md", "pushed")).toBe(false);
	});

	test("re-marking replaces the pending timer rather than stacking one", () => {
		// Two live timers for one marker means the FIRST expiry clears a window
		// the second call had just extended.
		const time = fakeTime();
		const t = new SyncedFileTable(time);
		t.mark("a.md", "pushed", 100);
		t.mark("a.md", "pushed", 100);

		expect(time.live).toBe(1);
	});

	test("clearMarker drops it immediately and cancels the timer", () => {
		const time = fakeTime();
		const t = new SyncedFileTable(time);
		t.mark("a.md", "remotelyDeleted", 100);
		t.clearMarker("a.md", "remotelyDeleted");

		expect(t.has("a.md", "remotelyDeleted")).toBe(false);
		expect(time.live).toBe(0);
	});

	test("an unmarked path is not marked", () => {
		const t = new SyncedFileTable(fakeTime());

		expect(t.has("ghost.md", "pushed")).toBe(false);
	});
});

describe("SyncedFileTable lifecycle", () => {
	test("rename carries markers to the new path", () => {
		const time = fakeTime();
		const t = new SyncedFileTable(time);
		t.mark("old.md", "flushed", 100);
		t.rename("old.md", "new.md");

		expect(t.has("new.md", "flushed")).toBe(true);
		expect(t.has("old.md", "flushed")).toBe(false);
	});

	test("rename onto an occupied path does not leak the displaced timers", () => {
		const time = fakeTime();
		const t = new SyncedFileTable(time);
		t.mark("old.md", "flushed", 100);
		t.mark("new.md", "pushed", 100);
		t.rename("old.md", "new.md");

		// The displaced entry's timer must be cancelled, not orphaned.
		expect(time.live).toBe(1);
		expect(t.has("new.md", "flushed")).toBe(true);
		expect(t.has("new.md", "pushed")).toBe(false);
	});

	test("renaming an untracked path is a no-op", () => {
		const t = new SyncedFileTable(fakeTime());

		expect(() => t.rename("nothing.md", "x.md")).not.toThrow();
	});

	test("forget drops the entry and cancels its timers", () => {
		const time = fakeTime();
		const t = new SyncedFileTable(time);
		t.mark("a.md", "pushed", 100);
		t.mark("a.md", "flushed", 100);
		t.forget("a.md");

		expect(time.live).toBe(0);
		expect(t.size).toBe(0);
	});

	test("destroy cancels every outstanding timer", () => {
		// One call replaces the three near-identical clear-every-timer loops the
		// maps needed in SyncEngine.destroy(), where adding a fourth marker meant
		// remembering to add a fourth loop.
		const time = fakeTime();
		const t = new SyncedFileTable(time);
		t.mark("a.md", "pushed", 100);
		t.mark("b.md", "flushed", 100);
		t.mark("c.md", "remotelyDeleted", 100);
		t.destroy();

		expect(time.live).toBe(0);
		expect(t.size).toBe(0);
	});

	test("a stale timer from before a rename does not delete a newer entry at the old path", () => {
		// The expiry closure captures the path it was created for, but rename()
		// moves the object to a different key. Re-marking the old path creates a
		// NEW entry there; when the stale timer fires it must not delete it.
		// Losing that entry silently drops echo suppression for a real file.
		const time = fakeTime();
		const t = new SyncedFileTable(time);
		t.mark("old.md", "flushed", 100);
		t.rename("old.md", "new.md");
		t.mark("old.md", "pushed", 100);

		// Only the PRE-rename timer. fireAll would also expire the marker under
		// assertion and pass for the wrong reason.
		time.fireOldest();

		expect(t.has("old.md", "pushed")).toBe(true);
		// ...and the renamed file keeps its own entry.
		expect(t.has("new.md", "flushed")).toBe(false);
	});

	test("an expired marker leaves no empty entry behind", () => {
		// Otherwise a long session accumulates one entry per path ever touched.
		const time = fakeTime();
		const t = new SyncedFileTable(time);
		t.mark("a.md", "pushed", 100);
		time.fireAll();

		expect(t.size).toBe(0);
	});
});

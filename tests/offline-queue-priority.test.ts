import { describe, expect, test } from "bun:test";
import { OfflineQueue, QueuePriority, queuedReason } from "../src/offline-queue";
import type { QueueEntry } from "../src/types";

function entry(path: string, over: Partial<QueueEntry> = {}): QueueEntry {
	return { path, action: "upsert", timestamp: 1000, ...over };
}

describe("queue priority", () => {
	test("still orders oldest-first within one priority", async () => {
		const q = new OfflineQueue();
		await q.enqueue(entry("b.md", { timestamp: 2000 }));
		await q.enqueue(entry("a.md", { timestamp: 1000 }));

		expect(q.all().map((e) => e.path)).toEqual(["a.md", "b.md"]);
	});

	test("a higher-priority entry jumps ahead of an older background one", async () => {
		const q = new OfflineQueue();
		await q.enqueue(entry("bulk.md", { timestamp: 1000, priority: QueuePriority.Background }));
		await q.enqueue(entry("open.md", { timestamp: 5000, priority: QueuePriority.OpenNote }));

		// The note the user is looking at should not wait behind a bulk import.
		expect(q.all().map((e) => e.path)).toEqual(["open.md", "bulk.md"]);
	});

	test("entries with no priority default to Normal", async () => {
		const q = new OfflineQueue();
		await q.enqueue(entry("legacy.md", { timestamp: 5000 }));
		await q.enqueue(entry("bg.md", { timestamp: 1000, priority: QueuePriority.Background }));
		await q.enqueue(entry("open.md", { timestamp: 9000, priority: QueuePriority.OpenNote }));

		// A persisted entry written before priority existed must not sink below
		// background work just because it lacks the field.
		expect(q.all().map((e) => e.path)).toEqual(["open.md", "legacy.md", "bg.md"]);
	});

	test("re-enqueueing a path can raise its priority", async () => {
		const q = new OfflineQueue();
		await q.enqueue(entry("a.md", { priority: QueuePriority.Background }));
		await q.enqueue(entry("a.md", { priority: QueuePriority.OpenNote }));

		expect(q.size).toBe(1);
		expect(q.all()[0].priority).toBe(QueuePriority.OpenNote);
	});

	test("survives a load of persisted entries that predate the priority field", () => {
		const q = new OfflineQueue();
		q.load([entry("old.md", { timestamp: 1 })]);

		expect(q.all()).toHaveLength(1);
		expect(() => q.all()).not.toThrow();
	});
});

describe("cancel", () => {
	test("removes a queued entry for a path", async () => {
		const q = new OfflineQueue();
		await q.enqueue(entry("a.md"));

		expect(q.cancel("a.md")).toBe(true);
		expect(q.size).toBe(0);
	});

	test("reports false when there was nothing to cancel", async () => {
		const q = new OfflineQueue();

		expect(q.cancel("ghost.md")).toBe(false);
	});

	test("respects vault scoping so one vault cannot cancel another's work", async () => {
		const q = new OfflineQueue();
		await q.enqueue(entry("a.md", { vaultId: "v1" }));

		expect(q.cancel("a.md", "v2")).toBe(false);
		expect(q.size).toBe(1);
	});

	test("cancelling is synchronous — a rename must not race the flush loop", async () => {
		// dequeue() awaits a persist round trip. A caller reacting to a vault
		// rename needs the entry gone NOW, before the flush loop can pick up work
		// for a path that no longer exists.
		const q = new OfflineQueue();
		await q.enqueue(entry("a.md"));
		q.cancel("a.md");

		expect(q.all()).toEqual([]);
	});
});

describe("queuedReason", () => {
	test("explains a queue held by being offline", () => {
		expect(queuedReason({ queued: 3, inFlight: 0, offline: true, syncBlocked: false })).toBe(
			"offline",
		);
	});

	test("explains a queue held by the sync gate", () => {
		expect(queuedReason({ queued: 3, inFlight: 0, offline: false, syncBlocked: true })).toBe(
			"sync-blocked",
		);
	});

	test("reports work in progress rather than a stall", () => {
		expect(queuedReason({ queued: 3, inFlight: 2, offline: false, syncBlocked: false })).toBe(
			"in-progress",
		);
	});

	test("returns null when there is nothing queued", () => {
		expect(
			queuedReason({ queued: 0, inFlight: 0, offline: true, syncBlocked: false }),
		).toBeNull();
	});

	test("prefers offline over sync-blocked when both hold", () => {
		// Offline is the one the user can act on, and the one that resolves itself.
		expect(queuedReason({ queued: 1, inFlight: 0, offline: true, syncBlocked: true })).toBe(
			"offline",
		);
	});

	test("names the stall when work is queued, online, unblocked and idle", () => {
		// The case that currently shows an unexplained spinner.
		expect(queuedReason({ queued: 5, inFlight: 0, offline: false, syncBlocked: false })).toBe(
			"waiting",
		);
	});
});

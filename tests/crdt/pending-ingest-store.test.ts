import { describe, expect, test } from "bun:test";
import { type PendingEntry, PendingIngestStore } from "../../src/crdt/pending-ingest-store";

const entry = (o: Partial<PendingEntry> = {}): PendingEntry => ({
	noteId: "n1",
	path: "a.md",
	vaultId: "v1",
	base: "base0",
	baseHash: 1,
	enqueuedAt: 100,
	source: "disk",
	...o,
});

function mk(initial: PendingEntry[] = []) {
	let disk: PendingEntry[] = structuredClone(initial);
	const saves: number[] = [];
	const open = () =>
		new PendingIngestStore(
			() => structuredClone(disk),
			async (all) => {
				await Promise.resolve();
				disk = structuredClone(all);
				saves.push(all.length);
			},
		);
	return { open, saves, disk: () => disk };
}

describe("PendingIngestStore", () => {
	test("put coalesces and keeps the oldest base", async () => {
		const s = mk().open();
		await s.put(entry());
		await s.put(
			entry({
				path: "b.md",
				text: "new",
				source: "editor",
				base: "base9",
				baseHash: 9,
				enqueuedAt: 500,
			}),
		);
		const e = s.get("n1");
		expect(e?.base).toBe("base0");
		expect(e?.baseHash).toBe(1);
		expect(e?.enqueuedAt).toBe(100);
		expect(e?.path).toBe("b.md");
		expect(e?.text).toBe("new");
		expect(e?.source).toBe("editor");
	});

	test("persists through save/load, durable before put resolves", async () => {
		const h = mk();
		await h.open().put(entry());
		expect(h.disk()).toHaveLength(1);
		expect(h.open().get("n1")?.base).toBe("base0");
	});

	test("delete drops the pending entry and never replays", async () => {
		const h = mk();
		const s = h.open();
		await s.put(entry());
		await s.delete("n1");
		expect(s.get("n1")).toBeUndefined();
		expect(h.open().get("n1")).toBeUndefined();
		expect(h.disk()).toHaveLength(0);
	});

	test("vault switch parks entries and resumes them", async () => {
		const h = mk();
		const s = h.open();
		await s.put(entry());
		await s.put(entry({ noteId: "n2", vaultId: "v2" }));
		expect(s.forVault("v1").map((e) => e.noteId)).toEqual(["n1"]);
		const re = h.open();
		expect(re.forVault("v2").map((e) => e.noteId)).toEqual(["n2"]);
		expect(re.forVault("v1")).toHaveLength(1);
	});

	test("delete of unknown noteId is a no-op", async () => {
		const s = mk().open();
		await s.delete("nope");
		expect(s.forVault("v1")).toEqual([]);
	});

	test("saves are serialized: a slow first save cannot land last with a stale snapshot", async () => {
		const written: PendingEntry[][] = [];
		let release1!: () => void;
		let calls = 0;
		const s = new PendingIngestStore(
			() => [],
			async (all) => {
				const n = ++calls;
				if (n === 1) await new Promise<void>((r) => (release1 = r));
				written.push(structuredClone(all));
			},
		);
		const p1 = s.put(entry());
		const p2 = s.put(entry({ noteId: "n2" }));
		await Promise.resolve();
		release1();
		await Promise.all([p1, p2]);
		expect(written[written.length - 1].map((e) => e.noteId).sort()).toEqual(["n1", "n2"]);
	});

	test("a delete racing a put never resurrects the deleted entry", async () => {
		const written: PendingEntry[][] = [];
		let release1!: () => void;
		let calls = 0;
		const s = new PendingIngestStore(
			() => [entry()],
			async (all) => {
				if (++calls === 1) await new Promise<void>((r) => (release1 = r));
				written.push(structuredClone(all));
			},
		);
		const p1 = s.put(entry({ noteId: "n2" }));
		const p2 = s.delete("n1");
		await Promise.resolve();
		release1();
		await Promise.all([p1, p2]);
		expect(written[written.length - 1].map((e) => e.noteId)).toEqual(["n2"]);
	});

	test("a rejected delete save rolls the entry back and rethrows", async () => {
		const s = new PendingIngestStore(
			() => [entry()],
			async () => {
				throw new Error("disk full");
			},
		);
		await expect(s.delete("n1")).rejects.toThrow("disk full");
		expect(s.get("n1")).toBeDefined();
	});
});

import { describe, expect, test } from "bun:test";
import { buildNoteSnapshot, buildVaultSnapshot, type SnapshotDeps } from "../src/debug-snapshot";

const DOC_TEXT = "# Title\n\nbody\n";

function deps(over: Partial<SnapshotDeps> = {}): SnapshotDeps {
	return {
		idForPath: () => "note-1",
		pathForId: () => "notes/a.md",
		registry: {
			hasDoc: () => true,
			projectedText: async () => DOC_TEXT,
			hasHistory: async () => true,
			encodeStateVector: async () => new Uint8Array([1, 2, 3]),
			isSynced: () => true,
			hasPendingGap: async () => false,
			hasUndeliveredOps: () => false,
			enrolled: new Set(["note-1"]),
			removedIds: new Set<string>(),
			residentIds: () => ["note-1"],
		},
		readDisk: async () => ({ length: DOC_TEXT.length, mtime: 1000, content: DOC_TEXT }),
		syncStateFor: () => ({ hash: 42, crdtHead: "head-abc", serverHash: "sh", seq: 9 }),
		isLiveBound: () => false,
		pendingPromises: () => [],
		...over,
	};
}

describe("buildNoteSnapshot", () => {
	test("resolves a path to its note_id and reports both directions", async () => {
		const snap = await buildNoteSnapshot("notes/a.md", deps());

		expect(snap.path).toBe("notes/a.md");
		expect(snap.noteId).toBe("note-1");
		expect(snap.idmap.bijective).toBe(true);
	});

	test("accepts a note_id as the lookup key too", async () => {
		const snap = await buildNoteSnapshot("note-1", deps({ idForPath: () => null }));

		expect(snap.path).toBe("notes/a.md");
		expect(snap.noteId).toBe("note-1");
	});

	test("flags a broken id map instead of silently reporting one direction", async () => {
		const snap = await buildNoteSnapshot(
			"notes/a.md",
			deps({ pathForId: () => "notes/OTHER.md" }),
		);

		expect(snap.idmap.bijective).toBe(false);
		expect(snap.idmap.pathForId).toBe("notes/OTHER.md");
	});

	test("a half-mapped id (forward only, no reverse) is NOT bijective", async () => {
		// path->id resolves but id->path does not. Nothing contradicts the forward
		// direction, so a naive check reads this as healthy — it is the exact
		// half-populated state that strands a flush with nowhere to write.
		const snap = await buildNoteSnapshot(
			"notes/a.md",
			deps({ idForPath: () => "note-1", pathForId: () => null }),
		);

		expect(snap.idmap.bijective).toBe(false);
	});

	test("an unmapped path is vacuously bijective — there is nothing to disagree about", async () => {
		const snap = await buildNoteSnapshot(
			"notes/ghost.md",
			deps({ idForPath: () => null, pathForId: () => null }),
		);

		expect(snap.idmap.bijective).toBe(true);
	});

	test("reports doc and disk as converged when their content matches", async () => {
		const snap = await buildNoteSnapshot("notes/a.md", deps());

		expect(snap.docMatchesDisk).toBe(true);
		expect(snap.doc?.length).toBe(DOC_TEXT.length);
		expect(snap.disk?.length).toBe(DOC_TEXT.length);
	});

	test("reports divergence when doc and disk differ — the question every incident starts with", async () => {
		const snap = await buildNoteSnapshot(
			"notes/a.md",
			deps({ readDisk: async () => ({ length: 3, mtime: 1, content: "old" }) }),
		);

		expect(snap.docMatchesDisk).toBe(false);
	});

	test("omits content by default and includes it only on request", async () => {
		const withoutContent = await buildNoteSnapshot("notes/a.md", deps());
		const withContent = await buildNoteSnapshot("notes/a.md", deps(), { includeContent: true });

		// Note bodies are private. A snapshot pasted into a support ticket must
		// not carry them unless the user deliberately asked.
		expect(withoutContent.doc?.content).toBeUndefined();
		expect(withoutContent.disk?.content).toBeUndefined();
		expect(withContent.doc?.content).toBe(DOC_TEXT);
		expect(withContent.disk?.content).toBe(DOC_TEXT);
	});

	test("hashes content even when it is withheld, so two sides stay comparable", async () => {
		const snap = await buildNoteSnapshot("notes/a.md", deps());

		expect(snap.doc?.hash).toBeDefined();
		expect(snap.doc?.hash).toBe(snap.disk?.hash as string);
	});

	test("reports room state", async () => {
		const snap = await buildNoteSnapshot("notes/a.md", deps());

		expect(snap.room).toMatchObject({
			resident: true,
			enrolled: true,
			synced: true,
			pendingGap: false,
			undelivered: false,
			removed: false,
			liveBound: false,
		});
	});

	test("surfaces a tombstoned note as removed rather than just absent", async () => {
		const snap = await buildNoteSnapshot(
			"notes/a.md",
			deps({
				registry: {
					...deps().registry,
					hasDoc: () => false,
					removedIds: new Set(["note-1"]),
				},
			}),
		);

		expect(snap.room.removed).toBe(true);
		expect(snap.room.resident).toBe(false);
		expect(snap.doc).toBeNull();
	});

	test("reports the server view from sync state", async () => {
		const snap = await buildNoteSnapshot("notes/a.md", deps());

		expect(snap.server).toMatchObject({ crdtHead: "head-abc", serverHash: "sh", seq: 9 });
		expect(snap.hasServerNote).toBe(true);
	});

	test("hasServerNote is false when no crdtHead has ever been recorded", async () => {
		const snap = await buildNoteSnapshot(
			"notes/a.md",
			deps({ syncStateFor: () => ({ hash: 1 }) }),
		);

		expect(snap.hasServerNote).toBe(false);
	});

	test("returns a usable snapshot for a path with no mapping at all", async () => {
		const snap = await buildNoteSnapshot(
			"notes/ghost.md",
			deps({ idForPath: () => null, pathForId: () => null }),
		);

		expect(snap.noteId).toBeNull();
		expect(snap.doc).toBeNull();
		expect(snap.room.resident).toBe(false);
	});

	test("a doc-layer failure degrades that section instead of failing the snapshot", async () => {
		// A snapshot is a debugging tool. If it throws on the exact broken state
		// it exists to describe, it is useless precisely when it is needed.
		const snap = await buildNoteSnapshot(
			"notes/a.md",
			deps({
				registry: {
					...deps().registry,
					projectedText: async () => {
						throw new Error("doc destroyed");
					},
				},
			}),
		);

		expect(snap.doc).toBeNull();
		expect(snap.errors).toContain("doc: doc destroyed");
	});

	test("a disk read failure degrades that section too", async () => {
		const snap = await buildNoteSnapshot(
			"notes/a.md",
			deps({
				readDisk: async () => {
					throw new Error("EACCES");
				},
			}),
		);

		expect(snap.disk).toBeNull();
		expect(snap.errors).toContain("disk: EACCES");
		expect(snap.docMatchesDisk).toBeNull();
	});
});

describe("buildVaultSnapshot", () => {
	test("summarises room counts and outstanding async work", async () => {
		const snap = buildVaultSnapshot(
			deps({
				pendingPromises: () => [{ label: "pull:notes/a.md", ageMs: 61_000 }],
			}),
		);

		expect(snap.rooms).toEqual({ resident: 1, enrolled: 1, removed: 0 });
		expect(snap.pending).toEqual([{ label: "pull:notes/a.md", ageMs: 61_000 }]);
	});

	test("orders pending work oldest first — the wedged one is what you want on top", () => {
		const snap = buildVaultSnapshot(
			deps({
				pendingPromises: () => [
					{ label: "young", ageMs: 10 },
					{ label: "wedged", ageMs: 90_000 },
					{ label: "middle", ageMs: 500 },
				],
			}),
		);

		expect(snap.pending.map((p) => p.label)).toEqual(["wedged", "middle", "young"]);
	});
});

// e2e test_107 restart case (backend PR 2607, run 43791484191, plugin
// 8ac3d17e): B edited a note at its old path; the note's identity had already
// moved (id map first, file after), so the edit was refused as "unmapped" and
// queued. The file then followed its identity to the new path and the server's
// text was written over it: the edit was gone. A move that follows identity
// must never write over bytes this device has not pushed.
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { fnv1a } from "../src/content-hash";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const ORIGINAL = "# A\n\nalpha 107\n";
const EDIT = "# A\n\nalpha 107\n\npeer edit 1234\n";

function setup() {
	const disk = new Map<string, string>([["Proj/a.md", EDIT]]);
	const files = new Map<string, TFile>([["Proj/a.md", new TFile("Proj/a.md")]]);
	const at = (p: string) => files.get(p) ?? null;
	const app = {
		vault: {
			configDir: ".obsidian",
			getName: () => "Vault",
			getAbstractFileByPath: (p: string) => at(p) ?? (p === "Done" ? ({} as any) : null),
			getFileByPath: at,
			cachedRead: async (f: TFile) => disk.get(f.path) ?? "",
			read: async (f: TFile) => disk.get(f.path) ?? "",
			// Real disk calls yield to the event loop, and refuse an existing target.
			rename: async (f: TFile, to: string) => {
				await new Promise((r) => setTimeout(r, 0));
				if (files.has(to)) throw new Error("Destination file already exists!");
				disk.set(to, disk.get(f.path) ?? "");
				disk.delete(f.path);
				files.delete(f.path);
				(f as any).path = to;
				files.set(to, f);
			},
			modify: async (f: TFile, text: string) => {
				await new Promise((r) => setTimeout(r, 0));
				disk.set(f.path, text);
			},
			create: async (p: string, text: string) => {
				if (files.has(p)) throw new Error("File already exists.");
				disk.set(p, text);
				files.set(p, new TFile(p));
			},
			createFolder: async () => {},
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const e = new SyncEngine(
		app,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 60_000 },
		mock().mockResolvedValue(undefined),
	);
	e.setReady();
	const ids = new NoteIdMap();
	e.setNoteIdMap(ids);
	(e as any).syncState.set("Proj/a.md", { hash: fnv1a(ORIGINAL), crdtHead: "h", seq: 3 });
	// The identity moved first (the relocation), the file has not yet.
	ids.set("Done/a.md", "id-a");
	(e as any).rememberRelocation("Proj/a.md", "Done/a.md");
	return { e, disk };
}

test("a relocation that only moved the note keeps the unpushed edit", async () => {
	const { e, disk } = setup();
	try {
		await (e as any).createFileWithFolders("Done/a.md", ORIGINAL);
		expect(disk.get("Done/a.md")).toBe(EDIT);
		expect(disk.has("Proj/a.md")).toBe(false);
	} finally {
		e.destroy();
	}
});

test("server changed too: its text wins at the path and the edit is kept beside it", async () => {
	const { e, disk } = setup();
	try {
		await (e as any).createFileWithFolders("Done/a.md", "# A\n\nserver rewrite\n");
		expect(disk.get("Done/a.md")).toBe("# A\n\nserver rewrite\n");
		expect([...disk.values()]).toContain(EDIT); // the conflict copy
	} finally {
		e.destroy();
	}
});

test("a clean file is still overwritten by the server text (unchanged behaviour)", async () => {
	const { e, disk } = setup();
	try {
		disk.set("Proj/a.md", ORIGINAL);
		await (e as any).createFileWithFolders("Done/a.md", "# A\n\nnewer\n");
		expect(disk.get("Done/a.md")).toBe("# A\n\nnewer\n");
		expect([...disk.keys()].filter((k) => k.includes("conflict"))).toEqual([]);
	} finally {
		e.destroy();
	}
});

/** The e2e shape: a merge base holds the text this device synced, and the
 *  recorded hash does NOT match it (a CRDT note records its own projection). */
function withBase(e: SyncEngine, text: string) {
	const store = new Map([["Done/a.md", { content: text, version: 1, ts: 0 }]]);
	(e as any).baseStore = {
		get: (p: string) => store.get(p),
		set: () => {},
		rename: () => {},
		delete: () => {},
	};
	(e as any).syncState.set("Proj/a.md", { hash: 12345, crdtHead: "h", seq: 3 });
}

const conflictCopies = (disk: Map<string, string>) =>
	[...disk.keys()].filter((k) => k.includes("conflict"));

test("e2e run 43846246580: a path-only move keeps the edit even when the recorded hash disagrees", async () => {
	const { e, disk } = setup();
	try {
		withBase(e, ORIGINAL);
		await (e as any).createFileWithFolders("Done/a.md", ORIGINAL);
		expect(disk.get("Done/a.md")).toBe(EDIT);
		expect(conflictCopies(disk)).toEqual([]);
	} finally {
		e.destroy();
	}
});

test("server and device edited different lines: both land in the note, no copy", async () => {
	const { e, disk } = setup();
	try {
		withBase(e, ORIGINAL);
		await (e as any).createFileWithFolders("Done/a.md", "# A server\n\nalpha 107\n");
		expect(disk.get("Done/a.md")).toBe("# A server\n\nalpha 107\n\npeer edit 1234\n");
		expect(conflictCopies(disk)).toEqual([]);
	} finally {
		e.destroy();
	}
});

test("overlapping edits: server text at the path, the edit kept as a copy", async () => {
	const { e, disk } = setup();
	try {
		withBase(e, ORIGINAL);
		disk.set("Proj/a.md", "# A\n\nalpha mine\n");
		await (e as any).createFileWithFolders("Done/a.md", "# A\n\nalpha theirs\n");
		expect(disk.get("Done/a.md")).toBe("# A\n\nalpha theirs\n");
		expect([...disk.values()]).toContain("# A\n\nalpha mine\n");
	} finally {
		e.destroy();
	}
});

// e2e run 44242969664 (test_107, device B): two conflict copies of a note B
// never edited. The text at the old path was the seed B had just pulled and
// recorded (its hash is the seed's own). The new path already held a
// head-only row (`hash: 0`, from setCrdtHead), so the identity move dropped
// the seed's row, and the mismatch then read the seed as an unpushed edit;
// two writes for the note at once each kept a copy.
const SEED = "# A\n\nalpha 107";
const SERVER = "# A\n\nalpha 107\n\noffline edit 1234\n";

/** Count keep-both decisions: two copies made in the same millisecond share a
 *  name, so counting files on disk would hide the second one. */
function countCopies(e: SyncEngine): { n: number } {
	const seen = { n: 0 };
	const real = (e as any).writeDriftConflictCopy.bind(e);
	(e as any).writeDriftConflictCopy = (...args: unknown[]) => {
		seen.n++;
		return real(...args);
	};
	return seen;
}

/** B's state: the seed on disk at the old path with its own hash recorded,
 *  and a head-only row already at the new path. */
function seeded(e: SyncEngine, disk: Map<string, string>, text: string) {
	disk.set("Proj/a.md", text);
	(e as any).syncState.set("Proj/a.md", { hash: fnv1a(SEED), crdtHead: "h", seq: 3 });
	(e as any).setCrdtHead("Done/a.md", "h2");
}

const twoWrites = (e: SyncEngine, text: string) =>
	Promise.all([e.writeCrdtNote("Done/a.md", text), e.writeCrdtNote("Done/a.md", text)]);

test("a just-pulled seed moved onto a head-only row is not an edit: no copy", async () => {
	const { e, disk } = setup();
	try {
		seeded(e, disk, SEED);
		await (e as any).createFileWithFolders("Done/a.md", SERVER);
		expect(disk.get("Done/a.md")).toBe(SERVER);
		expect(conflictCopies(disk)).toEqual([]);
	} finally {
		e.destroy();
	}
});

test("two writes for that note at once: still no copy", async () => {
	const { e, disk } = setup();
	try {
		seeded(e, disk, SEED);
		const copies = countCopies(e);
		await twoWrites(e, SERVER);
		expect(copies.n).toBe(0);
		expect(disk.get("Done/a.md")).toBe(SERVER);
		expect(disk.has("Proj/a.md")).toBe(false);
	} finally {
		e.destroy();
	}
});

// A REAL local edit with no push signal yet must still be kept, exactly once.
// None of these has a queued upsert, a debounce timer, or a push in flight.
const MINE = "# A\n\nalpha 107 mine\n";
for (const [why, arrange] of [
	[
		"made during a pull (parked for the post-pull push)",
		(e: SyncEngine) => {
			(e as any).pulling = true;
			(e as any).pendingPostPullPushes.add("Proj/a.md");
		},
	],
	[
		"made while sync was blocked (gate-modified, not journaled)",
		(e: SyncEngine) => (e as any).gateModified.add("Proj/a.md"),
	],
	["made while Obsidian was closed (startup catch-up runs before the push sweep)", () => {}],
] as const) {
	test(`an unqueued edit ${why} is kept beside the server text, once`, async () => {
		const { e, disk } = setup();
		try {
			seeded(e, disk, MINE);
			arrange(e);
			const copies = countCopies(e);
			await twoWrites(e, SERVER);
			expect(copies.n).toBe(1);
			expect(disk.get("Done/a.md")).toBe(SERVER);
			expect(conflictCopies(disk).map((k) => disk.get(k))).toEqual([MINE]);
		} finally {
			e.destroy();
		}
	});
}

// Review of #711 @ a93cd16d (MEDIUM): hash 0 also means "the server dropped
// this frame, re-send" (clearPushedBaselineForId). A drop landing mid-move,
// after the id map moved and before the file did, cleared the NEW path's row;
// adopting the old path's hash into it then echo-skipped the re-send, and the
// content never reached the server.
test("a frame dropped mid-move stays cleared after the move: the content is re-sent", async () => {
	const { e, disk } = setup();
	try {
		seeded(e, disk, SEED);
		e.clearPushedBaselineForId("id-a"); // the map already says Done/a.md
		await (e as any).createFileWithFolders("Done/a.md", SERVER);
		expect((e as any).syncState.get("Done/a.md").hash).toBe(0);
		// Nothing this device wrote is lost: its text is kept beside the server's.
		expect([...disk.values()]).toContain(SEED);
	} finally {
		e.destroy();
	}
});

test("the next recorded hash ends the deliberate clear", () => {
	const { e } = setup();
	try {
		(e as any).setCrdtHead("Done/a.md", "h2");
		e.clearPushedBaselineForId("id-a");
		expect((e as any).syncState.get("Done/a.md").unbanked).toBe(true);
		(e as any).setCrdtHead("Done/a.md", "h3"); // a head alone keeps it
		expect((e as any).syncState.get("Done/a.md").unbanked).toBe(true);
		(e as any).recordCrdtBaseline("Done/a.md", SERVER);
		expect((e as any).syncState.get("Done/a.md").unbanked).toBeUndefined();
		expect((e as any).syncState.get("Done/a.md").hash).toBe(fnv1a(SERVER));
	} finally {
		e.destroy();
	}
});

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

function setup(opts: { queued?: boolean } = {}) {
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
			// Real disk calls yield to the event loop: two writes in flight both
			// pass their existence checks before either moves the file.
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
	// The restart case's real evidence of an unpushed edit: the refused mint
	// queued it ("Mint refused but edit PRESERVED").
	if (opts.queued !== false) {
		void (e as any).queue.enqueue({
			path: "Proj/a.md",
			action: "upsert",
			kind: "note",
			mtime: 1,
			timestamp: 1,
			vaultId: "v1",
		});
	}
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

// e2e run 44242969664 (test_107, device B): B never edited the note. The text
// at the old path was the seed it had just pulled, with no merge base and a
// recorded hash that is not the text's own (the CRDT quirk). Then two inbound
// writes for the same id followed the identity move at once, and each kept a
// "conflict" copy of the seed.
const SEED = "# A\n\nalpha 107";

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
const SERVER = "# A\n\nalpha 107\n\noffline edit 1234\n";

test("no base, no unpushed edit: a hash mismatch alone is not an edit (no copy)", async () => {
	const { e, disk } = setup({ queued: false });
	try {
		disk.set("Proj/a.md", SEED);
		(e as any).syncState.set("Proj/a.md", { hash: 12345, crdtHead: "h", seq: 3 });
		await (e as any).createFileWithFolders("Done/a.md", SERVER);
		expect(disk.get("Done/a.md")).toBe(SERVER);
		expect(conflictCopies(disk)).toEqual([]);
	} finally {
		e.destroy();
	}
});

test("two writes for the same note at once follow the move once: no copy for a pulled seed", async () => {
	const { e, disk } = setup({ queued: false });
	try {
		disk.set("Proj/a.md", SEED);
		(e as any).syncState.set("Proj/a.md", { hash: 12345, crdtHead: "h", seq: 3 });
		await Promise.all([
			e.writeCrdtNote("Done/a.md", SERVER),
			e.writeCrdtNote("Done/a.md", SERVER),
		]);
		expect(disk.get("Done/a.md")).toBe(SERVER);
		expect(disk.has("Proj/a.md")).toBe(false);
		expect(conflictCopies(disk)).toEqual([]);
	} finally {
		e.destroy();
	}
});

test("two writes at once with a REAL unpushed edit keep it exactly once", async () => {
	const { e, disk } = setup();
	try {
		const copies = countCopies(e);
		await Promise.all([
			e.writeCrdtNote("Done/a.md", "# A\n\nserver rewrite\n"),
			e.writeCrdtNote("Done/a.md", "# A\n\nserver rewrite\n"),
		]);
		expect(disk.get("Done/a.md")).toBe("# A\n\nserver rewrite\n");
		expect(copies.n).toBe(1);
		expect(conflictCopies(disk).map((k) => disk.get(k))).toEqual([EDIT]);
	} finally {
		e.destroy();
	}
});

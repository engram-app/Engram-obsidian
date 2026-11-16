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
			rename: async (f: TFile, to: string) => {
				disk.set(to, disk.get(f.path) ?? "");
				disk.delete(f.path);
				files.delete(f.path);
				(f as any).path = to;
				files.set(to, f);
			},
			modify: async (f: TFile, text: string) => {
				disk.set(f.path, text);
			},
			create: async (p: string, text: string) => {
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

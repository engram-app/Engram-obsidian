/**
 * Server-side delete, then restore (backend safer-delete, Engram#2233 e2e test_106).
 *
 * Bug 1: the delete tears the note's CRDT doc down and tombstones its id in the
 * registry. A restore brings the SAME id back (fresh seq + upsert broadcast), and
 * every apply for it threw `Note was destroyed`, so the note never reappeared.
 * The tombstone is a hiding layer; "the server re-announces the id as live" is
 * its clearing event.
 *
 * Bug 2: a server delete of a just-synced ATTACHMENT ran the text drift check on
 * the binary file and wrote `img.png (conflict <stamp>).md` holding PNG bytes.
 *
 * Uses the REAL ProviderRegistry so tombstones and docs are genuine.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { fnv1aBase64 } from "../src/content-hash";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { fnv1a, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS, type NoteStreamEvent } from "../src/types";

function harness(dbPrefix: string) {
	const disk = new Map<string, string>();
	const created: string[] = [];
	const mgr = new ProviderRegistry({ dbPrefix, send: () => true, onFlushToDisk: async () => {} });
	const tfile = (p: string) => new TFile(p);
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? tfile(p) : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? tfile(p) : null)),
			cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify: mock(async (f: TFile, c: string) => {
				disk.set(f.path, c);
			}),
			create: mock(async (p: string, c: string) => {
				created.push(p);
				disk.set(p, c);
			}),
			createFolder: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: {
			trashFile: mock(async (f: TFile) => {
				disk.delete(f.path);
			}),
		},
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	const e = new SyncEngine(
		app,
		{ getManifest: mock().mockResolvedValue(null) } as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	e.setCrdtManager(mgr);
	e.setReady();
	const map = new NoteIdMap();
	e.setNoteIdMap(map);
	return { e, mgr, disk, map, created };
}

const ev = (over: Partial<NoteStreamEvent>): NoteStreamEvent => ({
	event_type: "upsert",
	path: "a.md",
	timestamp: Date.now(),
	kind: "note",
	...over,
});

/** A synced CRDT note `a.md` (id-a) that the server then deletes. */
async function deletedNote(dbPrefix: string) {
	const h = harness(dbPrefix);
	h.disk.set("a.md", "hello");
	h.map.set("a.md", "id-a");
	h.e.importSyncState({ "a.md": { hash: fnv1a("hello") } });
	const server = new Y.Doc();
	server.getText("content").insert(0, "hello");
	await h.mgr.applyRemoteUpdate("id-a", Y.encodeStateAsUpdate(server));

	await h.e.handleStreamEvent(ev({ event_type: "delete", id: "id-a" }));
	// Precondition: the delete trashed the file and tombstoned the id.
	expect(h.disk.has("a.md")).toBe(false);
	expect(h.mgr.removedIds.has("id-a")).toBe(true);
	return h;
}

describe("server delete then restore of a note", () => {
	test("the seq-replay row for the restored id re-materializes it", async () => {
		const h = await deletedNote("restore-seq");

		await h.e.applySyncChange({
			type: "note",
			id: "id-a",
			seq: 50,
			path: "a.md",
			title: "a",
			content: "hello",
			content_hash: "srv-hash",
			folder: "",
			tags: [],
			mtime: 1,
			updated_at: new Date().toISOString(),
			deleted: false,
			version: 3,
		} as any);

		expect(h.disk.get("a.md")).toBe("hello");
		expect(h.map.get("a.md")).toBe("id-a");
		expect(h.mgr.removedIds.has("id-a")).toBe(false);
		expect(h.created.filter((p) => p.includes("(conflict "))).toEqual([]);
	});

	test("the upsert broadcast for the restored id re-materializes it", async () => {
		const h = await deletedNote("restore-ws");

		await h.e.handleStreamEvent(
			ev({ id: "id-a", content: "hello", content_hash: "srv-hash", version: 3 }),
		);

		expect(h.disk.get("a.md")).toBe("hello");
		expect(h.map.get("a.md")).toBe("id-a");
	});
});

describe("server delete of a just-synced attachment", () => {
	test("writes no .md conflict copy of the binary file", async () => {
		const h = harness("att-delete");
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		// Disk read as TEXT never hashes like the base64 baseline a push records,
		// so the text drift proxy always reads a synced attachment as drifted.
		h.disk.set("img.png", new TextDecoder().decode(bytes));
		h.e.importSyncState({ "img.png": { hash: fnv1aBase64(bytes.buffer) } });

		await h.e.handleStreamEvent(
			ev({ event_type: "delete", path: "img.png", kind: "attachment" }),
		);

		expect(h.created).toEqual([]);
		expect(h.disk.has("img.png")).toBe(false);
	});
});

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

/** A seq-replay row for `path`/`id` (`deleted` flips it to a tombstone). */
const row = (id: string, path: string, seq: number, content: string, deleted = false) =>
	({
		type: "note",
		id,
		seq,
		path,
		title: path.replace(/\.md$/, ""),
		content,
		content_hash: `srv-${seq}`,
		folder: "",
		tags: [],
		mtime: 1,
		updated_at: new Date().toISOString(),
		deleted,
		version: seq,
	}) as any;

describe("server delete then restore of a note", () => {
	test("the seq-replay row for the restored id re-materializes it", async () => {
		const h = await deletedNote("restore-seq");

		await h.e.applySyncChange(row("id-a", "a.md", 50, "hello"));

		expect(h.disk.get("a.md")).toBe("hello");
		expect(h.map.get("a.md")).toBe("id-a");
		expect(h.mgr.removedIds.has("id-a")).toBe(false);
		expect(h.created.filter((p) => p.includes("(conflict "))).toEqual([]);
	});

	test("an unsequenced upsert broadcast does not revive; it asks for a seq replay", async () => {
		const h = await deletedNote("restore-ws");
		let replays = 0;
		(h.e as any).catchupViaSeqReplay = async () => {
			replays += 1;
		};

		await h.e.handleStreamEvent(
			ev({ id: "id-a", content: "hello", content_hash: "srv-hash", version: 3 }),
		);

		// A broadcast cannot tell a restore from a late pre-delete upsert.
		expect(h.disk.has("a.md")).toBe(false);
		expect(h.mgr.removedIds.has("id-a")).toBe(true);
		expect(replays).toBe(1);

		// The replayed row carries a seq, passes the fence, and revives.
		await h.e.applySyncChange(row("id-a", "a.md", 50, "hello"));
		expect(h.disk.get("a.md")).toBe("hello");
		expect(h.mgr.removedIds.has("id-a")).toBe(false);
	});

	test("a stale pre-delete upsert neither revives nor writes disk", async () => {
		const h = harness("restore-stale");
		h.disk.set("a.md", "hello");
		h.map.set("a.md", "id-a");
		h.e.importSyncState({ "a.md": { hash: fnv1a("hello"), seq: 40 } });
		await h.e.applySyncChange(row("id-a", "a.md", 50, "", true));
		expect(h.mgr.removedIds.has("id-a")).toBe(true);

		// The row from BEFORE the delete, replayed (gap-heal / fromZero race).
		await h.e.applySyncChange(row("id-a", "a.md", 40, "stale body"));

		expect(h.disk.has("a.md")).toBe(false);
		expect(h.mgr.removedIds.has("id-a")).toBe(true);
		expect(h.mgr.enrolled.size).toBe(0);
	});

	test("our own delete still queued past the 60 s window is not revived", async () => {
		const h = await deletedNote("restore-queued");
		h.e.setCrdtHasPendingOp((id) => id === "id-a");

		await h.e.applySyncChange(row("id-a", "a.md", 50, "hello"));

		expect(h.disk.has("a.md")).toBe(false);
		expect(h.mgr.removedIds.has("id-a")).toBe(true);
	});

	test("a bulk restore of 1,000 idle notes opens zero rooms", async () => {
		const h = harness("restore-bulk");
		h.e.setCrdtPorts({ enrollment: h.mgr });
		const N = 1000;
		const ids = Array.from({ length: N }, (_, i) => `id-${i}`);
		ids.forEach((id, i) => {
			h.disk.set(`n${i}.md`, `body ${i}`);
			h.map.set(`n${i}.md`, id);
		});
		for (const [i, id] of ids.entries())
			await h.e.applySyncChange(row(id, `n${i}.md`, 100 + i, "", true));
		expect(h.mgr.removedIds.size).toBe(N);

		for (const [i, id] of ids.entries())
			await h.e.applySyncChange(row(id, `n${i}.md`, 5000 + i, `body ${i}`));

		expect(h.mgr.removedIds.size).toBe(0);
		expect(h.disk.get("n999.md")).toBe("body 999");
		expect(h.mgr.enrolled.size).toBe(0);
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

/**
 * #578: a CRDT discovery flush must never be re-read as a local edit.
 *
 * Shape (backend e2e test_49 rapid REST edits, "Version 35 of 5" on every
 * device): the note's Y.Doc already holds server edits 1..2 (fan-outs applied
 * while the id was unmapped) and a fan-out left a head-only `hash: 0` row. The
 * discovery leg then wrote the REST row's body. When a fan-out's flush created
 * the file first, `vault.create` rejects "already exists" and discovery falls
 * back to `vault.modify`, which caches the new text before it resolves — and
 * before `flushFromCrdt` records the baseline. A fan-out landing in that window
 * captured the engine's own write as disk drift and diffed it into the doc as
 * a CLIENT-authored edit.
 *
 * Real ProviderRegistry so a corruption is a genuine Yjs merge, not mocked.
 */
import { expect, mock, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const PATH = "E2E/RapidEdits.md";
const ID = "id-rapid";
const body = (i: number) => `# Rapid Edit\nVersion ${i} of 5`;

/** The server's lineage: edit i rewrites the version digit, one update each. */
function serverEdits(): Uint8Array[] {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	const updates: Uint8Array[] = [];
	let sv = Y.encodeStateVector(doc);
	for (let i = 1; i <= 5; i++) {
		doc.transact(() => {
			text.delete(0, text.length);
			text.insert(0, body(i));
		});
		updates.push(Y.encodeStateAsUpdate(doc, sv));
		sv = Y.encodeStateVector(doc);
	}
	return updates;
}

async function scenario(dbPrefix: string) {
	const disk = new Map<string, string>();
	const map = new NoteIdMap();
	const hooks = {
		e: null as unknown as SyncEngine,
		// Runs inside vault.modify, after the text is cached, before it resolves.
		onModify: async (_p: string) => {},
		// A concurrent flush creates the file just before discovery's create.
		createRace: null as string | null,
	};
	const sent: string[] = [];
	const mgr = new ProviderRegistry({
		dbPrefix,
		send: (_id, frame) => {
			sent.push(frame);
			return true;
		},
		// Production wiring: an unmapped id is not flushed (content stays in the doc).
		onFlushToDisk: async (id, content) => {
			const p = map.pathForId(id);
			if (p) await hooks.e.flushFromCrdt(p, content);
		},
	});
	const mockApp = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? new TFile(p) : null)),
			cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify: mock(async (f: TFile, c: string) => {
				disk.set(f.path, c);
				await hooks.onModify(f.path);
			}),
			create: mock(async (p: string, c: string) => {
				if (hooks.createRace !== null) {
					disk.set(p, hooks.createRace);
					hooks.createRace = null;
				}
				if (disk.has(p)) throw new Error("File already exists.");
				disk.set(p, c);
			}),
			createFolder: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	const e = new SyncEngine(
		mockApp,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	hooks.e = e;
	e.setCrdtManager(mgr as never);
	e.setReady();
	e.setNoteIdMap(map);
	e.setLiveBoundCheck(() => false);
	e.setCrdtEnrollment({ enroll: mock(), reset: mock() } as never);

	const updates = serverEdits();
	// Edits 1..2 reach the doc while the id is still unmapped: no file yet.
	await mgr.applyRemoteUpdate(ID, updates[0]);
	await mgr.applyRemoteUpdate(ID, updates[1]);
	expect(await mgr.getText(ID)).toBe(body(2));
	// The upsert learns the id; a fan-out already left a head-only row
	// (setCrdtHead -> patchSyncedRow: hash 0, nothing recorded as synced).
	map.set(PATH, ID);
	(e as unknown as { setCrdtHead(p: string, h: string): void }).setCrdtHead(PATH, "h2");

	const discover = () =>
		e.applyChange({
			id: ID,
			path: PATH,
			title: "RapidEdits",
			content: body(3),
			folder: "E2E",
			tags: [],
			mtime: Date.now() / 1000,
			updated_at: new Date().toISOString(),
			deleted: false,
			version: 3,
		} as never);
	return { e, mgr, disk, sent, hooks, updates, discover };
}

test("#578: a fan-out landing in discovery's modify window (already-exists fallback) does not re-ingest the write", async () => {
	const { e, mgr, disk, sent, hooks, updates, discover } = await scenario("disc-echo-modify");
	const localEdit = spyOn(mgr, "applyLocalEdit");
	// A fan-out's flush created the file first; discovery falls back to modify.
	hooks.createRace = body(2);
	let fired = false;
	hooks.onModify = async () => {
		if (fired) return;
		fired = true;
		await e.applyPushedNoteUpdate(ID, updates[2], "h3");
	};
	await discover();
	hooks.onModify = async () => {};

	expect(fired).toBe(true);
	expect(localEdit).not.toHaveBeenCalled();
	expect(sent).toEqual([]);

	await e.applyPushedNoteUpdate(ID, updates[3], "h4");
	await e.applyPushedNoteUpdate(ID, updates[4], "h5");
	expect(await mgr.getText(ID)).toBe(body(5));
	expect(disk.get(PATH)).toBe(body(5));
	expect(localEdit).not.toHaveBeenCalled();
});

test("#578: discovery over a doc with history writes the DOC's text, not the REST row", async () => {
	const { e, mgr, disk, discover } = await scenario("disc-echo-doctext");
	const localEdit = spyOn(mgr, "applyLocalEdit");
	await discover();

	// The row carried edit 3, the doc is at edit 2: disk follows the doc, so
	// it never holds text the doc lacks.
	expect(disk.get(PATH)).toBe(body(2));
	// A later local edit therefore diffs only the user's change into the doc.
	disk.set(PATH, `${body(2)}\nuser line`);
	await e.flushStrandedNote(PATH, ID);
	expect(localEdit).toHaveBeenCalledTimes(1);
	expect(await mgr.getText(ID)).toBe(`${body(2)}\nuser line`);
});

test("#578: a real user edit after the discovery flush still reaches applyLocalEdit", async () => {
	const { e, mgr, disk, discover, updates } = await scenario("disc-echo-user");
	await discover();
	const localEdit = spyOn(mgr, "applyLocalEdit");

	const edited = `${disk.get(PATH)}\nuser line`;
	disk.set(PATH, edited);
	await e.applyPushedNoteUpdate(ID, updates[2], "h3");

	expect(localEdit).toHaveBeenCalledTimes(1);
	expect(localEdit.mock.calls[0][1]).toBe(edited);
	// Both survive the merge (where Yjs orders concurrent inserts is not what
	// this test is about).
	const merged = await mgr.getText(ID);
	expect(merged).toContain(body(3));
	expect(merged).toContain("user line");
});

test("#578: overlapping flushes to one path each keep their own in-flight guard", async () => {
	const { e, disk, hooks } = await scenario("disc-echo-overlap");
	disk.set(PATH, "old");
	let releaseInner: () => void = () => {};
	const innerHeld = new Promise<void>((r) => {
		releaseInner = r;
	});
	let innerDone: Promise<boolean> | null = null;
	let checked: boolean | null = null;
	hooks.onModify = async () => {
		if (innerDone) return;
		// The outer flush's text "A" is cached; an inner flush to the same path
		// starts and is still writing "B" when drift capture reads disk.
		hooks.onModify = async () => innerHeld;
		innerDone = e.flushFromCrdt(PATH, "B");
		await new Promise((r) => setTimeout(r, 0));
		const restore = disk.get(PATH);
		disk.set(PATH, "A");
		checked = e.needsColdReconcile(PATH, "A");
		disk.set(PATH, restore ?? "A");
	};
	const outer = e.flushFromCrdt(PATH, "A");
	await outer;
	expect(checked).toBe(false);
	releaseInner();
	await innerDone;
	// Both writes finished: the guard is gone, the baseline governs again.
	expect(e.needsColdReconcile(PATH, "A")).toBe(true);
	expect(e.needsColdReconcile(PATH, "B")).toBe(false);
});

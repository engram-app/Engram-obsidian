/**
 * Deleting a note must not leave an EMPTY file behind at the same path.
 *
 * Observed 2026-07-28 on 1.18.2-pr.348: delete a note in Obsidian, the file
 * goes away, then an identically-named EMPTY file appears and stays. The
 * emptiness is the fingerprint — a resurrected buffer or conflict copy would
 * carry the note's text, so only a freshly-constructed Y.Doc projects "".
 *
 * Chain: a stray inbound frame for the deleted note rebuilds its registry
 * entry from scratch (`removed` is read by applyLocalEdit/applyRemoteUpdate
 * but NOT by the entry-creation path) → the new empty doc completes a
 * syncStep2 → `onSynced` sees text.length === 0 → `onEmptyStep2` →
 * `materializeEmptyDiscovered` → `flushFromCrdt("")` → the Discovery branch
 * CREATES the file.
 *
 * Two guards close it, mirroring `discoverAnnouncedNote`, which already
 * refuses to materialize a note this device is deleting.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import * as encoding from "lib0/encoding";
import { TFile } from "obsidian";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteDestroyedError } from "../src/crdt/destroyed-error";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { MESSAGE_SYNC, toB64 } from "../src/crdt/wire";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

/** An empty-doc syncStep2 — the server's "genuinely empty note" reply, which
 *  is what fires onEmptyStep2. */
function emptyStep2(): string {
	const enc = encoding.createEncoder();
	encoding.writeVarUint(enc, MESSAGE_SYNC);
	syncProtocol.writeSyncStep2(enc, new Y.Doc());
	return toB64(encoding.toUint8Array(enc));
}

function scenario(dbPrefix: string) {
	const disk = new Map<string, string>();
	const created: string[] = [];

	const mgr = new ProviderRegistry({
		dbPrefix,
		send: () => true,
		onFlushToDisk: async () => undefined,
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
			}),
			create: mock(async (p: string, c: string) => {
				created.push(p);
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
	e.setCrdtManager(mgr);
	e.setReady();
	const map = new NoteIdMap();
	map.set("gone.md", "id-gone");
	e.setNoteIdMap(map);

	return { e, mgr, created, disk };
}

describe("deleted note must not re-materialize empty", () => {
	test("materializeEmptyDiscovered skips a note this device just deleted", async () => {
		const { e, created } = scenario("mat-recent-delete");

		// The delete has been issued: handleDelete tombstones the id before the
		// send, which is the state a racing empty-STEP2 arrives in.
		(e as unknown as { markRecentlyDeleted(id: string): void }).markRecentlyDeleted("id-gone");

		await e.materializeEmptyDiscovered("gone.md", "id-gone");

		expect(created).toEqual([]);
	});

	test("materializeEmptyDiscovered skips a note with a delete still queued", async () => {
		const { e, created } = scenario("mat-pending-delete");

		// Offline: the delete is durably queued but unsent, so the id-keyed
		// cooldown may already have lapsed — the path-keyed queue is the guard.
		await (
			e as unknown as {
				queue: {
					enqueue(c: Record<string, unknown>): Promise<void>;
				};
			}
		).queue.enqueue({
			path: "gone.md",
			action: "delete",
			kind: "note",
			timestamp: Date.now(),
		});

		await e.materializeEmptyDiscovered("gone.md", "id-gone");

		expect(created).toEqual([]);
	});

	test("an inbound frame does not rebuild a removed note's doc", async () => {
		const { mgr } = scenario("recv-after-remove");

		await mgr.applyRemoteUpdate("id-gone", Y.encodeStateAsUpdate(new Y.Doc()));
		await mgr.removeDoc("id-gone");
		expect(mgr.docs.has("id-gone")).toBe(false);

		// A late fan-out / handshake reply for the deleted note. Relay's contract:
		// touching a destroyed doc THROWS rather than get-or-creating it, so the
		// caller decides explicitly instead of silently resurrecting the room.
		await expect(mgr.receive("id-gone", emptyStep2())).rejects.toThrow(NoteDestroyedError);

		// Rebuilding the entry is what lets an empty syncStep2 complete and fire
		// onEmptyStep2 → materialize an empty file at the deleted path.
		expect(mgr.docs.has("id-gone")).toBe(false);
	});
});

describe("liveness during an in-flight local edit", () => {
	test("a delete during applyLocalEdit's reread window does not seed the dead doc", async () => {
		const { mgr } = scenario("reread-delete-race");

		await mgr.applyLocalEdit("id-gone", "seed");
		const doc = await mgr.getDoc("id-gone");

		// The reread resolves only AFTER the note is deleted — the exact window
		// where a post-await liveness check let a seed land on a destroyed doc.
		const consumed = await mgr.applyLocalEdit("id-gone", "later", undefined, async () => {
			await mgr.removeDoc("id-gone");
			return "content read after the delete";
		});

		expect(consumed).toBeNull();
		expect(doc.getText("content").toJSON()).not.toContain("after the delete");
	});
});

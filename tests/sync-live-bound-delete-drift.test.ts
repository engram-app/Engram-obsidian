/**
 * A note you OPEN in Obsidian and then delete must not leave a
 * "(conflict <stamp>)" copy behind.
 *
 * Two seams conspire:
 *  1. `handleModify`'s editor-owns-the-file gate returns before anything
 *     refreshes `syncState`, so a live-bound note's recorded baseline freezes
 *     at whatever the last REMOTE flush wrote. Every subsequent autosave
 *     widens the gap between disk and baseline.
 *  2. Both inbound-delete drift sites gate the keep-both copy on
 *     `needsColdReconcile` — a baseline-vs-disk hash proxy that now reads
 *     "converged content" as "un-synced local drift" and writes the copy.
 *
 * The copy exists to protect edits that would die with the CRDT room, so the
 * fix is NOT to delete it: it must fire on a positive signal (the doc holds
 * frames the server has not acknowledged), not on the hash proxy.
 *
 * Uses the REAL ProviderRegistry so sync state is genuine, not mocked.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import * as encoding from "lib0/encoding";
import { TFile } from "obsidian";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { MESSAGE_SYNC, toB64 } from "../src/crdt/wire";
import { fnv1a, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS, type NoteChange } from "../src/types";

/** Build an engine whose note `a.md` is CRDT-managed, live-bound, and whose
 *  disk content has drifted from the recorded baseline (the exact state an
 *  opened-and-typed-in note reaches).
 *
 *  `deliverable` controls whether the provider's transport accepts frames:
 *  true  → the doc reaches isFullySynced (nothing buffered, server has it all)
 *  false → frames buffer locally (offline edits the server has NOT seen) */
async function liveBoundScenario(opts: {
	dbPrefix: string;
	deliverable: boolean;
	/** Reopen a registry over this prefix's existing IndexedDB instead of
	 *  seeding a fresh doc. The doc is left un-hydrated. */
	reopen?: boolean;
}) {
	const disk = new Map<string, string>([["a.md", "BASE typed-in-obsidian"]]);
	const created: string[] = [];

	const mgr = new ProviderRegistry({
		dbPrefix: opts.dbPrefix,
		send: () => opts.deliverable,
		onFlushToDisk: async (_id, content) => {
			disk.set("a.md", content);
		},
	});
	const returned = {
		mgr,
		disk,
		conflictCopies: () => created.filter((p) => p.includes("(conflict ")),
	};

	const tfile = (p: string) => new TFile(p);
	const mockApp = {
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
		mockApp,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	e.setCrdtManager(mgr);
	e.setReady();
	const map = new NoteIdMap();
	map.set("a.md", "id-a");
	e.setNoteIdMap(map);
	// CRDT-sole oracle: a recorded head under the path marks the note
	// server-known, which is what routes the delete through the CRDT branch.
	(e as unknown as { setCrdtHead(p: string, h: string): void }).setCrdtHead(
		"a.md",
		"server-head",
	);
	(e as unknown as { confirmedNoteIds: Set<string> }).confirmedNoteIds.add("id-a");
	e.setLiveBoundCheck((p) => p === "a.md");
	if (opts.reopen) return { e, ...returned };

	// Seed the doc so the note has a real room.
	const server = new Y.Doc();
	server.getText("content").insert(0, "BASE");
	await mgr.applyRemoteUpdate("id-a", Y.encodeStateAsUpdate(server));

	if (opts.deliverable) {
		// Complete a REAL handshake: a syncStep2 carrying the server's state is
		// what flips the provider's `synced` flag, so the doc genuinely reports
		// "the server has everything" rather than a poked test flag.
		mgr.setConnected(true);
		const enc = encoding.createEncoder();
		encoding.writeVarUint(enc, MESSAGE_SYNC);
		syncProtocol.writeSyncStep2(enc, server);
		await mgr.receive("id-a", toB64(encoding.toUint8Array(enc)));
	}

	// The baseline records what that remote flush wrote — NOT what the user has
	// since typed into the open editor.
	e.importSyncState({ "a.md": { hash: fnv1a("BASE") } });
	disk.set("a.md", "BASE typed-in-obsidian");

	return {
		e,
		mgr,
		disk,
		conflictCopies: () => created.filter((p) => p.includes("(conflict ")),
	};
}

const tombstone = (path: string): NoteChange => ({
	path,
	title: "a",
	folder: "",
	tags: [],
	mtime: Date.now(),
	updated_at: new Date().toISOString(),
	deleted: true,
});

describe("live-bound note delete drift", () => {
	test("live-bound modify refreshes the synced baseline", async () => {
		const { e, disk } = await liveBoundScenario({
			dbPrefix: "lb-baseline",
			deliverable: true,
		});

		// Precondition: the frozen baseline reads the open note as drifted.
		expect(e.needsColdReconcile("a.md", disk.get("a.md") as string)).toBe(true);

		e.handleModify(new TFile("a.md"));
		await new Promise((r) => setTimeout(r, 10));

		// The editor owns this content and it is already in the Y.Doc — the
		// baseline must track it, not lag behind it.
		expect(e.needsColdReconcile("a.md", disk.get("a.md") as string)).toBe(false);
	});

	test("delete of a delivered live-bound note writes no conflict copy", async () => {
		const { e, conflictCopies } = await liveBoundScenario({
			dbPrefix: "lb-delivered",
			deliverable: true,
		});

		await e.applyChange(tombstone("a.md"));

		expect(conflictCopies()).toEqual([]);
	});

	test("delete of a live-bound note with undelivered ops keeps a conflict copy", async () => {
		const { e, conflictCopies } = await liveBoundScenario({
			dbPrefix: "lb-undelivered",
			deliverable: false,
		});

		await e.applyChange(tombstone("a.md"));

		// The server never acknowledged this doc's frames — deleting the room
		// would destroy them, so the keep-both copy is correct here.
		expect(conflictCopies()).toHaveLength(1);
	});
});

describe("delete after a socket resume", () => {
	// Engram e2e test_cold_heal_room_budget (run 41273017448): a device with NO
	// local edits wrote "(conflict …)" copies when the server deleted notes
	// right after a resume. A disconnect wipes every provider's handshake
	// `synced` flag (clearSynced), so `hasUndeliveredOps` reads true for any
	// resident doc whose heal handshake has not landed yet, while its disk
	// already holds the server's content. Nothing local exists to preserve.
	test("a resident doc that holds only server state writes no conflict copy", async () => {
		const { e, mgr, disk, conflictCopies } = await liveBoundScenario({
			dbPrefix: "lb-resumed",
			deliverable: true,
		});
		e.setLiveBoundCheck(() => false);
		// Disk holds exactly what the doc holds; the baseline lags behind it
		// (the staged convergence commits only when the heal handshake lands).
		disk.set("a.md", "BASE");
		e.importSyncState({ "a.md": { hash: fnv1a("OLDER") } });
		// Socket drop + resume: synced marks wiped, no handshake answered yet.
		mgr.clearSynced();
		mgr.setConnected(false);
		mgr.setConnected(true);
		expect(mgr.hasUndeliveredOps("id-a")).toBe(true);

		await e.applyChange(tombstone("a.md"));

		expect(conflictCopies()).toEqual([]);
	});

	test("disk drift the doc never saw still keeps a conflict copy", async () => {
		const { e, mgr, disk, conflictCopies } = await liveBoundScenario({
			dbPrefix: "lb-resumed-drift",
			deliverable: true,
		});
		e.setLiveBoundCheck(() => false);
		disk.set("a.md", "BASE edited-while-offline");
		e.importSyncState({ "a.md": { hash: fnv1a("BASE") } });
		mgr.clearSynced();
		mgr.setConnected(false);
		mgr.setConnected(true);

		await e.applyChange(tombstone("a.md"));

		expect(conflictCopies()).toHaveLength(1);
	});
});

describe("delete keep-both gate reads the HYDRATED doc", () => {
	// Review of #678: an entry `ensureEntrySync` just created holds an EMPTY
	// doc until IndexedDB loads, and the delivery receipt of an empty doc reads
	// true. Reading the receipt before the projection skipped the copy of an
	// edit that was persisted locally but never delivered.
	test("an undelivered persisted edit keeps its copy while the doc is still loading", async () => {
		const prefix = "lb-hydrating";
		const first = new ProviderRegistry({
			dbPrefix: prefix,
			send: () => false,
			onFlushToDisk: async () => {},
		});
		const server = new Y.Doc();
		server.getText("content").insert(0, "BASE");
		await first.applyRemoteUpdate("id-a", Y.encodeStateAsUpdate(server));
		await first.applyLocalEdit("id-a", "BASE local-only");
		const persisted = await first.projectedText("id-a");
		expect(persisted).toContain("local-only");
		await first.destroyAll();

		const { e, mgr, disk, conflictCopies } = await liveBoundScenario({
			dbPrefix: prefix,
			deliverable: false,
			reopen: true,
		});
		e.setLiveBoundCheck(() => false);
		disk.set("a.md", persisted);
		e.importSyncState({ "a.md": { hash: fnv1a("BASE") } });
		// Something (an editor bind, catch-up) touches the doc: resident, not loaded.
		mgr.residentText("id-a");

		await e.applyChange(tombstone("a.md"));

		expect(conflictCopies()).toHaveLength(1);
		await mgr.destroyAll();
	});
});

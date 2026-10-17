/**
 * Tests: single-write-path push pipeline. Genesis (never-server-known) notes
 * ride the same bounded per-file `pushFile` loop as everything else — the
 * crdt_create_batch RPC and its chunking were retired (per-file rewrite:
 * per-file work units, per-file progress, per-file failure isolation).
 *
 * Uses the real harness: a mock CrdtManager wired via `setCrdtManager`, the
 * shared mock vault/api, and `setCrdtHead`/noteIdMap to mark a note
 * server-known (the `hasServerNote` oracle) — mirroring
 * tests/sync-socket-catchup.test.ts.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import "fake-indexeddb/auto";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { TFile } from "obsidian";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { fnv1a } from "../src/content-hash";
import {
	CONTENT_KEY,
	frontmatterOf,
	projectNote,
	rawFrontmatterOf,
} from "../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry as CrdtManagerType } from "../src/crdt/provider-registry";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { encodeUpdateFrame, fromB64 } from "../src/crdt/wire";
import EngramSyncPlugin from "../src/main";
import { rlog } from "../src/remote-log";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function makeApp(files: TFile[], contentByPath: Record<string, string>): any {
	return {
		vault: {
			configDir: ".obsidian",
			read: mock((f: TFile) => Promise.resolve(contentByPath[f.path] ?? "body")),
			cachedRead: mock((f: TFile) => Promise.resolve(contentByPath[f.path] ?? "body")),
			readBinary: mock().mockResolvedValue(new ArrayBuffer(3)),
			getMarkdownFiles: mock().mockReturnValue(files),
			getFiles: mock().mockReturnValue(files),
			getAbstractFileByPath: mock().mockReturnValue(null),
			getFileByPath: mock().mockReturnValue(null),
			modify: mock().mockResolvedValue(undefined),
			process: mock().mockResolvedValue(""),
			modifyBinary: mock().mockResolvedValue(undefined),
			create: mock().mockResolvedValue(undefined),
			createBinary: mock().mockResolvedValue(undefined),
			createFolder: mock().mockResolvedValue(undefined),
			trash: mock().mockResolvedValue(undefined),
			rename: mock().mockResolvedValue(undefined),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	};
}

function makeApi(): EngramApi {
	return {
		pushNote: mock().mockResolvedValue({ note: { path: "" }, chunks_indexed: 1 }),
		pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
		pushAttachment: mock().mockResolvedValue({ attachment: {} }),
		deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
		deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
		health: mock().mockResolvedValue(true),
		ping: mock().mockResolvedValue({ ok: true }),
		getManifest: mock().mockResolvedValue(null),
		getRateLimit: mock().mockResolvedValue(0),
		registerVault: mock().mockResolvedValue({
			id: "v1",
			name: "T",
			slug: "t",
			is_default: true,
		}),
	} as unknown as EngramApi;
}

/** A mock CrdtManager sufficient for the push pipeline. `encodeGenesisUpdate`
 *  returns tiny deterministic bytes (the real byte-exact encoding is covered by
 *  the dedicated round-trip test below). */
function mockCrdt(over: Partial<CrdtManagerType> = {}): Partial<CrdtManagerType> {
	return {
		encodeGenesisUpdate: ((_c: string) => new Uint8Array([1, 2, 3])) as any,
		closeDoc: () => {},
		...over,
	};
}

function makeEngine(
	files: TFile[],
	contentByPath: Record<string, string> = {},
	crdt: Partial<CrdtManagerType> = mockCrdt(),
): { engine: SyncEngine; app: any; api: EngramApi } {
	const app = makeApp(files, contentByPath);
	const api = makeApi();
	const engine = new SyncEngine(
		app,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setCrdtManager(crdt as unknown as CrdtManagerType);
	engine.setReady();
	engine.setNoteIdMap(new NoteIdMap());
	return { engine, app, api };
}

describe("pushModifiedFiles — genesis rides the per-file loop", () => {
	test("a never-synced note is pushed via pushFile (socket-native genesis)", async () => {
		const file = new TFile("Notes/Fresh.md", Date.now());
		const { engine } = makeEngine([file], { "Notes/Fresh.md": "# fresh" });
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		const pushed = await engine.pushModifiedFiles();

		expect(pushFile).toHaveBeenCalledTimes(1);
		expect(pushFile.mock.calls[0][0]).toBe(file);
		expect(pushed).toEqual({ pushed: 1, failed: 0 });
	});
});

describe("encodeGenesisUpdate + encodeUpdateFrame — frame correctness", () => {
	test("the genesis frame reconstructs the exact note content on a fresh peer doc", async () => {
		const mgr = new ProviderRegistry({
			send: () => true,
			onFlushToDisk: async () => {},
		});
		const content = "---\ntitle: Hello\n---\n\n# Body\n\nSome text.";
		const frame = encodeUpdateFrame(mgr.encodeGenesisUpdate(content));

		// Apply the frame exactly as the server room would: decode messageSync,
		// readSyncMessage into a fresh doc.
		const peer = new Y.Doc();
		const decoder = decoding.createDecoder(fromB64(frame));
		expect(decoding.readVarUint(decoder)).toBe(0); // MESSAGE_SYNC
		const reply = encoding.createEncoder();
		encoding.writeVarUint(reply, 0);
		syncProtocol.readSyncMessage(decoder, reply, peer, "remote");

		// The full note re-projects (frontmatter fence + body) — the true
		// round-trip correctness property, independent of whitespace details.
		const { order, values } = frontmatterOf(peer);
		const projected = projectNote(
			order,
			values,
			peer.getText(CONTENT_KEY).toJSON(),
			rawFrontmatterOf(peer),
		);
		expect(projected).toBe(content);
		peer.destroy();
	});

	test("an EMPTY-content genesis note round-trips to empty content (no crash, no garbage) — historical flake class", async () => {
		const mgr = new ProviderRegistry({
			send: () => true,
			onFlushToDisk: async () => {},
		});
		const content = "";
		const frame = encodeUpdateFrame(mgr.encodeGenesisUpdate(content));

		const peer = new Y.Doc();
		const decoder = decoding.createDecoder(fromB64(frame));
		expect(decoding.readVarUint(decoder)).toBe(0); // MESSAGE_SYNC
		const reply = encoding.createEncoder();
		encoding.writeVarUint(reply, 0);
		syncProtocol.readSyncMessage(decoder, reply, peer, "remote");

		const { order, values } = frontmatterOf(peer);
		const projected = projectNote(
			order,
			values,
			peer.getText(CONTENT_KEY).toJSON(),
			rawFrontmatterOf(peer),
		);
		expect(projected).toBe(content);
		peer.destroy();
	});
});

describe("SyncEngine.pullAll — replay-from-0 (Task 5)", () => {
	test("pull-all-keep replays from 0 via catchupViaSeqReplay and never trashes local extras", async () => {
		const localOnly = new TFile("LocalOnly.md", Date.now());
		const { engine, app } = makeEngine([localOnly], { "LocalOnly.md": "# local" });
		let fromZero: boolean | undefined;
		(engine as any).catchupViaSeqReplay = async (o: any) => {
			fromZero = o?.fromZero;
			return {
				applied: 1,
				files: 1,
				failed: 0,
				deletes: 0,
				serverIds: new Set(["s1"]),
				serverAttachmentPaths: new Set<string>(),
				ran: true,
				complete: true,
			};
		};

		const applied = await engine.pullAll({ deleteLocalExtras: false });

		expect(fromZero).toBe(true);
		expect(applied).toBe(1);
		expect(app.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("pull-all-delete-local trashes local ids absent from the server set, keeps ids present", async () => {
		const stale = new TFile("Stale.md", Date.now());
		const kept = new TFile("Kept.md", Date.now());
		const { engine, app } = makeEngine([stale, kept], {
			"Stale.md": "# stale",
			"Kept.md": "# kept",
		});
		(engine as any).noteIdMap.set("Stale.md", "local-stale-id");
		(engine as any).noteIdMap.set("Kept.md", "kept-id");
		(engine as any).catchupViaSeqReplay = async () => ({
			applied: 0,
			serverIds: new Set(["kept-id"]),
			serverAttachmentPaths: new Set<string>(),
			ran: true,
			complete: true,
		});

		await engine.pullAll({ deleteLocalExtras: true });

		expect(app.fileManager.trashFile).toHaveBeenCalledTimes(1);
		expect(app.fileManager.trashFile).toHaveBeenCalledWith(stale);
	});

	test("mirror invariant: the local wipe-trash does NOT echo-push a delete to the server", async () => {
		// Uses the REAL trashRemotelyDeleted (not mocked) so its remotelyDeleted
		// echo-suppression marker actually gets set, then simulates the vault's
		// own 'delete' event firing on that same file post-trash (what Obsidian
		// does after fileManager.trashFile resolves) — mirrors the test_86
		// wipe/delete-wins regression class.
		const stale = new TFile("Stale.md", Date.now());
		const { engine, api } = makeEngine(
			[stale],
			{ "Stale.md": "# stale" },
			mockCrdt({ removeDoc: async () => {} }),
		);
		(engine as any).noteIdMap.set("Stale.md", "local-stale-id");
		const enqueued: unknown[] = [];
		engine.setCrdtEnqueue((op: unknown) => enqueued.push(op));
		(engine as any).catchupViaSeqReplay = async () => ({
			applied: 0,
			serverIds: new Set<string>(),
			serverAttachmentPaths: new Set<string>(),
			ran: true,
			complete: true,
		});

		await engine.pullAll({ deleteLocalExtras: true });
		await engine.handleDelete(stale); // the vault delete event the trash fires

		expect(enqueued).toEqual([]); // no crdt_delete echoed back to the server
		expect(api.deleteNote).not.toHaveBeenCalled();
	});

	test("(#5b) pull-all-delete-local trashes a server-absent local attachment, keeps a server-present one", async () => {
		const staleAtt = new TFile("Attachments/stale.png", Date.now());
		const keptAtt = new TFile("Attachments/kept.png", Date.now());
		const { engine, app } = makeEngine([staleAtt, keptAtt], {});
		(engine as any).catchupViaSeqReplay = async () => ({
			applied: 0,
			serverIds: new Set<string>(),
			serverAttachmentPaths: new Set(["Attachments/kept.png"]),
			ran: true,
			complete: true,
		});

		await engine.pullAll({ deleteLocalExtras: true });

		expect(app.fileManager.trashFile).toHaveBeenCalledTimes(1);
		expect(app.fileManager.trashFile).toHaveBeenCalledWith(staleAtt);
	});

	test("(#5b) mirror invariant: the attachment wipe-trash does NOT echo-push a delete to the server", async () => {
		// Uses the REAL trashRemotelyDeleted (not mocked) so its remotelyDeleted
		// echo-suppression marker actually gets set, then simulates the vault's
		// own 'delete' event firing on that same attachment post-trash — the
		// attachment twin of the note mirror-invariant test above.
		const staleAtt = new TFile("Attachments/stale.png", Date.now());
		const { engine, api } = makeEngine([staleAtt], {});
		(engine as any).catchupViaSeqReplay = async () => ({
			applied: 0,
			serverIds: new Set<string>(),
			serverAttachmentPaths: new Set<string>(),
			ran: true,
			complete: true,
		});

		await engine.pullAll({ deleteLocalExtras: true });
		await engine.handleDelete(staleAtt); // the vault delete event the trash fires

		expect(api.deleteAttachment).not.toHaveBeenCalled();
	});
});

describe("destructive sync choices — coalesced-replay whole-vault data-loss guard", () => {
	// The catastrophic bug: when a background catch-up already holds the
	// single-flight lock (seqReplayRunning), a destructive choice's OWN
	// catchupViaSeqReplay COALESCES and returns EMPTY serverIds. Pre-fix,
	// _pullAll's wipe branch then treats EVERY local file as a server-absent
	// "extra" → trashes the whole vault. The gate-open live-WS race that fires a
	// background `void this.catchupViaSeqReplay()` is exactly this contention.
	test("pull-all-delete-local ABORTS (never trashes) when the replay COALESCES to an empty server set", async () => {
		const a = new TFile("A.md", Date.now());
		const b = new TFile("B.md", Date.now());
		const { engine, app } = makeEngine([a, b], { "A.md": "# a", "B.md": "# b" });
		(engine as any).noteIdMap.set("A.md", "id-a");
		(engine as any).noteIdMap.set("B.md", "id-b");
		// A background replay already holds the lock → the wipe's replay coalesces
		// (returns EMPTY sets, ran:false) on every retry, so it exhausts and aborts.
		(engine as any).seqReplayRunning = true;

		const applied = await engine.pullAll({ deleteLocalExtras: true });

		// Pre-fix this trashed BOTH files (whole vault). Post-fix: nothing trashed.
		expect(app.fileManager.trashFile).not.toHaveBeenCalled();
		expect(applied).toBe(0);
	});

	test("a GENUINE (ran:true) replay still trashes ONLY the true extras", async () => {
		const stale = new TFile("Stale.md", Date.now());
		const kept = new TFile("Kept.md", Date.now());
		const { engine, app } = makeEngine([stale, kept], {
			"Stale.md": "# s",
			"Kept.md": "# k",
		});
		(engine as any).noteIdMap.set("Stale.md", "stale-id");
		(engine as any).noteIdMap.set("Kept.md", "kept-id");
		(engine as any).catchupViaSeqReplay = async () => ({
			applied: 0,
			serverIds: new Set(["kept-id"]),
			serverAttachmentPaths: new Set<string>(),
			ran: true,
			complete: true,
		});

		await engine.pullAll({ deleteLocalExtras: true });

		expect(app.fileManager.trashFile).toHaveBeenCalledTimes(1);
		expect(app.fileManager.trashFile).toHaveBeenCalledWith(stale);
	});
});

describe("SyncEngine.pushAll — replace-remote via crdtDelete + attachment-delete (Task 6)", () => {
	test("deletes server-only note-ids AND attachment-paths absent locally, never trashes local", async () => {
		const keepMd = new TFile("Keep.md", Date.now());
		const keepPng = new TFile("Keep.png", Date.now());
		const { engine, api } = makeEngine([keepMd, keepPng], { "Keep.md": "# keep" });
		// A local note + attachment that ALSO exist on the server — must survive.
		(engine as any).noteIdMap.set("Keep.md", "local-keep-id");

		const deleted: string[] = [];
		const delAttach: string[] = [];
		(engine as any).crdtDelete = async (id: string) => {
			deleted.push(id);
			return { doc_id: id };
		};
		// Reuse the exact server-attachment-delete call wipeRemote used: api.deleteAttachment.
		(api.deleteAttachment as any) = mock(async (p: string) => {
			delAttach.push(p);
			return { deleted: true, path: p };
		});
		(engine as any).catchupViaSeqReplay = async () => ({
			applied: 0,
			serverIds: new Set(["local-keep-id", "remote-extra-id"]),
			serverAttachmentPaths: new Set(["Keep.png", "remote-extra.png"]),
			// The real enumerateOnly replay always reports each note's latest path.
			serverNotePaths: new Map([
				["local-keep-id", "Keep.md"],
				["remote-extra-id", "remote-extra.md"],
			]),
			ran: true,
			complete: true,
		});
		(engine as any).pushFile = mock().mockResolvedValue(true);
		// The sacred invariant tripwire: a replace-remote sync must NEVER trash a
		// local file (the 2026-07-08 vault-wipe incident). Spy the only local-trash
		// seam and assert it stays untouched.
		const localTrashed: string[] = [];
		(engine as any).trashRemotelyDeleted = async (f: any) => localTrashed.push(f.path);

		await engine.pushAll({ replaceRemote: true, localSnapshot: engine.snapshotLocalPaths() });

		expect(deleted).toEqual(["remote-extra-id"]); // only the server-only note-id
		expect(delAttach).toEqual(["remote-extra.png"]); // only the server-only attachment-path
		expect(localTrashed).toHaveLength(0); // NEVER delete local (decorative — replace-remote
		// never calls trashRemotelyDeleted; the load-bearing checks are below)
		// The real invariant: crdtDelete/deleteAttachment must never target a
		// LOCALLY-PRESENT id/path. The `toEqual` checks above already pin this
		// for THIS fixture (they'd fail if "local-keep-id" or "Keep.png" leaked
		// in), but restate it explicitly so the test fails loudly if the
		// enumeration ever starts including local entries.
		expect(deleted).not.toContain("local-keep-id");
		expect(delAttach).not.toContain("Keep.png");
	});

	// Fix-pass regression: the enumeration underneath replaceRemote used to be a
	// PLAIN catchupViaSeqReplay({fromZero:true}) — an APPLYING replay — so
	// enumerating the server set downloaded every remote-only note/attachment
	// into the local vault as an orphan (which then resurrects on the next
	// sync). Wires the REAL catchupViaSeqReplay (via crdtCatchupSince) instead
	// of stubbing it, so this proves pushAll's enumeration pass never applies.
	test("replace-remote enumeration never materializes remote-only extras locally", async () => {
		const { engine, api } = makeEngine([]); // no local files at all
		const applySpy = mock(async () => true);
		(engine as any).applySyncChange = applySpy;
		(engine as any).crdtDelete = async (id: string) => ({ doc_id: id });
		(api.deleteAttachment as any) = mock().mockResolvedValue({ deleted: true, path: "" });
		(engine as any).pushFile = mock().mockResolvedValue(true);

		engine.setCrdtCatchupSince(async () => ({
			changes: [
				{
					type: "note",
					id: "remote-note-id",
					seq: 1,
					path: "Remote.md",
					title: "Remote",
					content: "remote body",
					folder: "",
					tags: [],
					mtime: 1,
					updated_at: "2026-01-01T00:00:00Z",
					deleted: false,
				},
				{
					type: "attachment",
					id: "att-1",
					seq: 2,
					path: "Remote.png",
					mime_type: "image/png",
					size_bytes: 10,
					mtime: 2,
					updated_at: "2026-01-01T00:00:00Z",
					deleted: false,
				},
			],
			has_more: false,
			next_seq: null,
		}));

		await engine.pushAll({ replaceRemote: true, localSnapshot: new Set<string>() });

		expect(applySpy).not.toHaveBeenCalled(); // enumeration did NOT pull the extras in
	});
});

describe("SyncEngine.pushAll: replace-remote never deletes ignored server paths", () => {
	// Ignored paths are omitted from the local snapshot, so before the fix every
	// server note in an ignored folder looked like a server-only extra and was
	// deleted. They are intentionally unsynced, not extras.
	test("server notes/attachments under an ignore pattern survive; a non-ignored extra is still deleted", async () => {
		const { engine, api } = makeEngine([]);
		(engine as any).settings.excludedFolders = ["Archive"];
		const deleted: string[] = [];
		const delAttach: string[] = [];
		(engine as any).crdtDelete = async (id: string) => {
			deleted.push(id);
			return { doc_id: id };
		};
		(api.deleteAttachment as any) = mock(async (p: string) => {
			delAttach.push(p);
			return { deleted: true, path: p };
		});
		(engine as any).applySyncChange = mock(async () => true);
		(engine as any).pushFile = mock().mockResolvedValue(true);
		const note = (id: string, seq: number, path: string) => ({
			type: "note",
			id,
			seq,
			path,
			title: path,
			content: "x",
			folder: "",
			tags: [],
			mtime: seq,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
		});
		const att = (id: string, seq: number, path: string) => ({
			type: "attachment",
			id,
			seq,
			path,
			mime_type: "image/png",
			size_bytes: 10,
			mtime: seq,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
		});
		engine.setCrdtCatchupSince(async () => ({
			changes: [
				note("archived-id", 1, "Archive/Old.md"),
				note("extra-id", 2, "Extra.md"),
				att("a1", 3, "Archive/img.png"),
				att("a2", 4, "extra.png"),
			],
			has_more: false,
			next_seq: null,
		}));

		await engine.pushAll({ replaceRemote: true, localSnapshot: new Set<string>() });

		expect(deleted).toEqual(["extra-id"]);
		expect(delAttach).toEqual(["extra.png"]);
	});

	test("a note renamed INTO an ignored folder is judged by its latest path", async () => {
		const { engine } = makeEngine([]);
		(engine as any).ignorePatterns = ["Archive/"];
		const deleted: string[] = [];
		(engine as any).crdtDelete = async (id: string) => {
			deleted.push(id);
			return { doc_id: id };
		};
		(engine as any).pushFile = mock().mockResolvedValue(true);
		const note = (id: string, seq: number, path: string) => ({
			type: "note",
			id,
			seq,
			path,
			title: path,
			content: "x",
			folder: "",
			tags: [],
			mtime: seq,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
		});
		engine.setCrdtCatchupSince(async () => ({
			changes: [
				note("moved-id", 1, "Notes/x.md"),
				note("extra-id", 2, "Extra.md"),
				note("moved-id", 3, "Archive/x.md"),
			],
			has_more: false,
			next_seq: null,
		}));

		await engine.pushAll({ replaceRemote: true, localSnapshot: new Set<string>() });

		expect(deleted).toEqual(["extra-id"]);
	});
});

describe("SyncEngine.pushAll: replace-remote spares a note it cannot place", () => {
	// An op with an id but no path leaves the note's latest path unknown, so
	// nothing proves it is outside an excluded folder. Fail safe: keep it.
	test("a live note id with no known path is not deleted", async () => {
		const { engine } = makeEngine([]);
		(engine as any).settings.excludedFolders = ["Archive"];
		const deleted: string[] = [];
		(engine as any).crdtDelete = async (id: string) => {
			deleted.push(id);
			return { doc_id: id };
		};
		(engine as any).pushFile = mock().mockResolvedValue(true);
		(engine as any).applySyncChange = mock(async () => true);
		const note = (id: string, seq: number, path: string | null) => ({
			type: "note",
			id,
			seq,
			path,
			title: "t",
			content: "x",
			folder: "",
			tags: [],
			mtime: seq,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
		});
		engine.setCrdtCatchupSince(async () => ({
			changes: [note("unplaced-id", 1, null), note("extra-id", 2, "Extra.md")],
			has_more: false,
			next_seq: null,
		}));

		const warn = spyOn(rlog(), "warn");
		await engine.pushAll({ replaceRemote: true, localSnapshot: new Set<string>() });
		const lines = warn.mock.calls.map((c) => String(c[1]));
		warn.mockRestore();

		expect(deleted).toEqual(["extra-id"]);
		// Mirror mode says it kept them: a count, never a path.
		expect(lines.some((l) => /1 server note\(s\) with no known path/.test(l))).toBe(true);
	});
});

describe("SyncEngine.pullAll: a rename into an ignored folder is not a local extra", () => {
	// Another device moved Notes/x.md into an excluded folder. This device still
	// maps its old local path to that id; the wipe must not trash it as an extra
	// just because the note's latest server path is ignored here.
	test("the still-mapped local file survives pull-all-delete-local", async () => {
		const local = new TFile("Notes/x.md", Date.now());
		const { engine, app } = makeEngine([local], { "Notes/x.md": "# x" });
		(engine as any).settings.excludedFolders = ["Archive"];
		(engine as any).noteIdMap.set("Notes/x.md", "moved-id");
		(engine as any).applySyncChange = mock(async () => false);
		const note = (seq: number, path: string) => ({
			type: "note",
			id: "moved-id",
			seq,
			path,
			title: path,
			content: "x",
			folder: "",
			tags: [],
			mtime: seq,
			updated_at: "2026-01-01T00:00:00Z",
			deleted: false,
		});
		engine.setCrdtCatchupSince(async () => ({
			changes: [note(1, "Notes/x.md"), note(2, "Archive/x.md")],
			has_more: false,
			next_seq: null,
		}));

		await engine.pullAll({ deleteLocalExtras: true });

		expect(app.fileManager.trashFile).not.toHaveBeenCalled();
	});
});

describe("pushPartitioned — per-file genesis (no batch RPC)", () => {
	// per-file rewrite: genesis notes ride the same bounded per-file loop
	// as everything else. pushFile's socket-native genesis (crdt_create) already
	// owns every edge case the batch mirrored (mint-refusal, ADOPT, delete-wins,
	// oversized→REST); the batch was a second, lesser copy of that path and a
	// 25-note blast radius on every failure. Per-file = per-file progress and
	// per-file failure isolation.
	test("genesis notes route through pushFile, one call per file", async () => {
		const files = [0, 1, 2].map((i) => new TFile(`Notes/g${i}.md`, Date.now()));
		const { engine } = makeEngine(files, Object.fromEntries(files.map((f) => [f.path, "# g"])));
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		const out = await (engine as any).pushPartitioned(files, "incremental");

		expect(pushFile).toHaveBeenCalledTimes(3);
		expect(out).toEqual({ pushed: 3, failed: 0 });
	});

	test("emits pushing progress per completed file, not per chunk", async () => {
		const files = [0, 1, 2].map((i) => new TFile(`Notes/p${i}.md`, Date.now()));
		const { engine } = makeEngine(files, Object.fromEntries(files.map((f) => [f.path, "# p"])));
		(engine as any).pushFile = mock().mockResolvedValue(true);
		const currents: number[] = [];
		engine.onSyncProgress = (p) => {
			if (p.phase === "pushing") currents.push(p.current);
		};

		await (engine as any).pushPartitioned(files, "incremental");

		// One event per completed file; the count climbs to the full total.
		expect(currents.length).toBeGreaterThanOrEqual(3);
		expect(Math.max(...currents)).toBe(3);
	});

	test("incremental mode: one file's failure is counted, the rest still push", async () => {
		const files = [0, 1, 2].map((i) => new TFile(`Notes/f${i}.md`, Date.now()));
		const { engine } = makeEngine(files, Object.fromEntries(files.map((f) => [f.path, "# f"])));
		(engine as any).pushFile = mock().mockImplementation((f: TFile) =>
			f.path === "Notes/f1.md"
				? Promise.reject(new Error("sendRequest timeout: crdt_create"))
				: Promise.resolve(true),
		);

		const out = await (engine as any).pushPartitioned(files, "incremental");

		expect(out).toEqual({ pushed: 2, failed: 1 });
		expect((engine as any).issues.get("Notes/f1.md")?.message).toContain("timeout");
	});
});

describe("pushFile — echo suppression runs before the push slot (#426)", () => {
	test("an echoed note does not queue behind in-flight pushes", async () => {
		const file = new TFile("Notes/Echo.md", Date.now());
		const { engine } = makeEngine([file], { "Notes/Echo.md": "# same" });
		// The engine itself wrote this content (flushFromCrdt → recordCrdtBaseline),
		// so syncState already holds the exact disk hash. Obsidian still fires a
		// modify event for it; the resulting push is pure echo.
		(engine as any).stampSyncedRow("Notes/Echo.md", { hash: fnv1a("# same") });
		// Every push slot held by a real in-flight upload.
		(engine as any).activePushCount = (engine as any).maxConcurrentPushes;

		const result = await Promise.race([
			(engine as any).pushFile(file),
			new Promise((r) => setTimeout(() => r("HUNG"), 50)),
		]);

		expect(result).toBe(false);
	});

	test("a genuinely changed note still waits for a slot", async () => {
		const file = new TFile("Notes/Real.md", Date.now());
		const { engine } = makeEngine([file], { "Notes/Real.md": "# edited" });
		(engine as any).stampSyncedRow("Notes/Real.md", { hash: fnv1a("# stale") });
		(engine as any).activePushCount = (engine as any).maxConcurrentPushes;

		const result = await Promise.race([
			(engine as any).pushFile(file),
			new Promise((r) => setTimeout(() => r("HUNG"), 50)),
		]);

		expect(result).toBe("HUNG");
	});
});

describe("SyncEngine.reincludeFolder: Sync again for an excluded folder", () => {
	const LAST_SYNC = "2026-10-01T00:00:00.000Z";
	const EDITED_BEFORE = new Date("2026-09-01T00:00:00Z").getTime();
	/** The vault holds exactly `files`. */
	function present(app: any, files: TFile[]) {
		app.vault.getAbstractFileByPath.mockImplementation(
			(p: string) => files.find((f) => f.path === p) ?? null,
		);
	}

	test("a tracked note edited while excluded is pushed, though its mtime predates lastSync", async () => {
		const edited = new TFile("Archive/a.md", EDITED_BEFORE);
		const { engine, app } = makeEngine([edited], { "Archive/a.md": "# edited while excluded" });
		present(app, [edited]);
		engine.importSyncState({ "Archive/a.md": { hash: fnv1a("# as last synced") } });
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		await engine.reincludeFolder("Archive");
		await engine.pushModifiedFiles(LAST_SYNC);

		expect(pushFile.mock.calls.map((c: any[]) => c[0].path)).toEqual(["Archive/a.md"]);
		// Pushed as an edit of the tracked note, not as a re-created one.
		expect((engine as any).syncState.has("Archive/a.md")).toBe(true);
	});

	test("the content re-check is one-shot: a clean sweep clears it", async () => {
		const edited = new TFile("Archive/a.md", EDITED_BEFORE);
		const { engine, app } = makeEngine([edited], { "Archive/a.md": "# x" });
		present(app, [edited]);
		engine.importSyncState({ "Archive/a.md": { hash: fnv1a("# old") } });
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		await engine.reincludeFolder("Archive");
		await engine.pushModifiedFiles(LAST_SYNC);
		await engine.pushModifiedFiles(LAST_SYNC);

		expect(pushFile).toHaveBeenCalledTimes(1);
	});

	test("other folders keep the mtime filter", async () => {
		const other = new TFile("Notes/b.md", EDITED_BEFORE);
		const { engine, app } = makeEngine([other], { "Notes/b.md": "# b" });
		present(app, [other]);
		engine.importSyncState({ "Notes/b.md": { hash: fnv1a("# old") } });
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		await engine.reincludeFolder("Archive");
		await engine.pushModifiedFiles(LAST_SYNC);

		expect(pushFile).not.toHaveBeenCalled();
	});

	test("a tracked note deleted while excluded is deleted on the server, not resurrected", async () => {
		const { engine, app } = makeEngine([]);
		engine.importSyncState({ "Archive/gone.md": { hash: fnv1a("# gone") } });
		(engine as any).noteIdMap.set("Archive/gone.md", "gone-id");
		(engine as any).crdt.removeDoc = async () => {};
		const enqueued: any[] = [];
		(engine as any).crdtEnqueue = (op: any) => enqueued.push(op);
		engine.setCrdtCatchupSince(async () => ({
			changes: [
				{
					type: "note",
					id: "gone-id",
					seq: 1,
					path: "Archive/gone.md",
					title: "gone",
					content: "# gone",
					folder: "Archive",
					tags: [],
					mtime: 1,
					updated_at: "2026-01-01T00:00:00Z",
					deleted: false,
				},
			],
			has_more: false,
			next_seq: null,
		}));

		await engine.reincludeFolder("Archive");
		await engine.catchupViaSeqReplay();

		expect(app.vault.create).not.toHaveBeenCalled();
		expect(enqueued).toEqual([{ kind: "delete", docId: "gone-id", path: "Archive/gone.md" }]);
	});
});

describe("reincludeFolder always completes the re-include", () => {
	test("a local delete that throws still re-includes the folder and rewinds", async () => {
		const { engine } = makeEngine([]);
		engine.importSyncState({ "Archive/gone.md": { hash: fnv1a("# gone") } });
		(engine as any).deleteSyncedPath = mock(() => Promise.reject(new Error("offline")));

		await engine.reincludeFolder("Archive");

		expect(engine.exportReincludedFolders()).toEqual(["Archive"]);
		expect(engine.getSeqRewindFloor()).toBe(0);
	});
});

describe("Sync again survives a restart before the push pass", () => {
	test("a save landing inside the delete loop still carries what is owed", async () => {
		const files: TFile[] = [];
		const { engine: first } = makeEngine(files);
		first.importSyncState({ "Archive/gone.md": { hash: fnv1a("# gone") } });
		first.fullSync = mock(() => new Promise<never>(() => {}));
		const written: any[] = [];
		const p1 = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings: { ...DEFAULT_SETTINGS, excludedFolders: ["Archive"] },
			syncEngine: first,
			noteIdMap: new NoteIdMap(),
			writePluginData: mock(async (d: any) => {
				written.push(structuredClone(d));
			}),
			handleSyncError: mock(),
		});
		// Any other save (a cursor persist, a token rotation) during the deletes.
		(first as any).deleteSyncedPath = async () => {
			await p1.persistEngineState();
		};

		await p1.syncFolderAgain("Archive");
		const saved = written.at(-1);

		const { engine: second } = makeEngine(files);
		const p2 = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings: saved.settings,
			syncEngine: second,
		});
		p2.hydrateReincludedFolders(saved);
		expect(saved.settings.excludedFolders).toEqual([]);
		expect(second.exportReincludedFolders()).toEqual(["Archive"]);
		expect(second.getSeqRewindFloor()).toBe(0);
	});

	test("an edit made while excluded is still pushed after the engine is rebuilt from saved data", async () => {
		const edited = new TFile("Archive/a.md", new Date("2026-09-01T00:00:00Z").getTime());
		const files = [edited];
		const content = { "Archive/a.md": "# edited while excluded" };
		const boot = () => {
			const built = makeEngine(files, content);
			built.app.vault.getAbstractFileByPath.mockImplementation(
				(p: string) => files.find((f) => f.path === p) ?? null,
			);
			return built.engine;
		};
		const pluginOn = (engine: SyncEngine, settings: any, written: any[]) =>
			Object.assign(Object.create(EngramSyncPlugin.prototype), {
				settings,
				syncEngine: engine,
				noteIdMap: new NoteIdMap(),
				writePluginData: mock(async (d: any) => {
					written.push(structuredClone(d));
				}),
				handleSyncError: mock(),
			});

		// Session 1: Sync again, then Obsidian quits before any push pass runs.
		const first = boot();
		first.importSyncState({ "Archive/a.md": { hash: fnv1a("# as last synced") } });
		first.fullSync = mock(() => new Promise<never>(() => {}));
		const written: any[] = [];
		const p1 = pluginOn(first, { ...DEFAULT_SETTINGS, excludedFolders: ["Archive"] }, written);
		await p1.syncFolderAgain("Archive");
		const saved = written.at(-1);

		// Session 2: a fresh engine hydrated from data.json.
		const second = boot();
		second.importSyncState(saved.syncState);
		const p2 = pluginOn(second, saved.settings, []);
		p2.hydrateReincludedFolders(saved);
		// The genesis replay is still owed too.
		expect(second.getSeqRewindFloor()).toBe(0);
		const pushFile = mock().mockResolvedValue(true);
		(second as any).pushFile = pushFile;
		await second.pushModifiedFiles("2026-10-01T00:00:00.000Z");

		expect(pushFile.mock.calls.map((c: any[]) => c[0].path)).toEqual(["Archive/a.md"]);
	});
});

describe("SyncEngine.untrackedNotePaths", () => {
	test("a note another device already uploaded is not new", () => {
		const files = ["Archive/mine.md", "Archive/theirs.md"].map((p) => new TFile(p, 1));
		const { engine } = makeEngine(files);
		// The vault index knows the server holds this path.
		(engine as any).noteIdMap.set("Archive/theirs.md", "server-id");
		expect(engine.untrackedNotePaths("Archive")).toEqual(["Archive/mine.md"]);
	});
	test("applies the plan's ignore rules, but not the folder's own exclusion", () => {
		const files = ["Archive/new.md", "Archive/drafts/d.md", "Archive/skip.md"].map(
			(p) => new TFile(p, 1),
		);
		const { engine } = makeEngine(files);
		const settings = (engine as any).settings;
		settings.excludedFolders = ["Archive"]; // still excluded when Sync again asks
		settings.ignorePatterns = "drafts/";
		engine.updateSettings(settings);
		engine.ignoredFiles.add("Archive/skip.md");
		expect(engine.untrackedNotePaths("Archive")).toEqual(["Archive/new.md"]);
	});

	test("counts only never-synced notes under the folder", () => {
		const files = ["Archive/new.md", "Archive/old.md", "Archive/img.png", "Notes/new.md"].map(
			(p) => new TFile(p, 1),
		);
		const { engine } = makeEngine(files);
		engine.importSyncState({ "Archive/old.md": { hash: 1 } });
		expect(engine.untrackedNotePaths("Archive")).toEqual(["Archive/new.md"]);
	});
});

describe("SyncEngine.holdReinclude", () => {
	test("saves carry the folder and an owed replay; no run spends it; undo restores", async () => {
		const { engine } = makeEngine([]);
		const undo = engine.holdReinclude("Archive");
		expect(engine.exportReincludedFolders()).toEqual(["Archive"]);
		expect(engine.getSeqRewindFloor()).toBe(0);
		undo();
		expect(engine.exportReincludedFolders()).toEqual([]);
		expect(engine.getSeqRewindFloor()).toBeNull();
	});
});

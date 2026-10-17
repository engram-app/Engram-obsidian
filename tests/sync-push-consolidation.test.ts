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
import { TFile, TFolder } from "obsidian";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { fnv1a, fnv1aBase64 } from "../src/content-hash";
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
import { LimitExceededError } from "../src/limit-error";
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
		expect(out).toEqual({ pushed: 3, failed: 0, capped: 0 });
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

		expect(out).toEqual({ pushed: 2, failed: 1, capped: 0 });
		expect((engine as any).issues.get("Notes/f1.md")?.message).toContain("timeout");
	});

	test("a create the notes cap refused is capped, not a failure (first sync too)", async () => {
		const files = [0, 1].map((i) => new TFile(`Notes/c${i}.canvas`, Date.now()));
		const { engine } = makeEngine(files, Object.fromEntries(files.map((f) => [f.path, "{}"])));
		(engine as any).pushFile = mock().mockImplementation((f: TFile) =>
			f.path === "Notes/c1.canvas"
				? Promise.reject(new LimitExceededError("notes_cap_reached", null, "notes", 3, 3))
				: Promise.resolve(true),
		);

		const out = await (engine as any).pushPartitioned(files, "incremental");

		expect(out).toEqual({ pushed: 1, failed: 0, capped: 1 });
		// Still recorded and logged, like any refused push.
		expect((engine as any).issues.get("Notes/c1.canvas")?.message).toContain("notes_cap");
	});

	test("capped is counted from pushFile's own reason, never guessed from the gate", async () => {
		const files = [0, 1, 2].map((i) => new TFile(`Notes/q${i}.md`, Date.now()));
		const { engine } = makeEngine(files, Object.fromEntries(files.map((f) => [f.path, "# q"])));
		// The cap is closed, but q1 was queued and q2 unchanged: neither is capped.
		(engine as any).notesCapGate = { isClosed: () => true, trip() {}, reset() {}, open() {} };
		(engine as any).pushFile = mock().mockImplementation((f: TFile) =>
			Promise.resolve(
				f.path === "Notes/q0.md"
					? { ok: false, reason: "capped" }
					: f.path === "Notes/q1.md"
						? { ok: false, reason: "queued" }
						: { ok: false, reason: "unchanged" },
			),
		);

		const out = await (engine as any).pushPartitioned(files, "incremental");

		expect(out).toEqual({ pushed: 0, failed: 0, capped: 1 });
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

		expect(result).toEqual({ ok: false, reason: "unchanged" });
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

describe("renaming an excluded folder keeps it excluded", () => {
	function setup(existing: string[] = []) {
		const { engine, app, api } = makeEngine([]);
		app.vault.getAbstractFileByPath.mockImplementation((p: string) =>
			existing.includes(p) ? ({ path: p } as any) : null,
		);
		const settings = (engine as any).settings;
		settings.excludedFolders = ["Archive"];
		const plugin = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			app,
			settings,
			syncEngine: engine,
			noteIdMap: new NoteIdMap(),
			writePluginData: mock(async () => {}),
		});
		return { engine, plugin, settings, api };
	}

	test("Archive renamed to Old: Old's files are still ignored", () => {
		const { engine, plugin, settings } = setup();
		plugin.followExcludedFolderRename("Old", "Archive");
		expect(settings.excludedFolders).toEqual(["Old"]);
		expect(engine.shouldIgnore("Old/x.md")).toBe(true);
	});

	test("a child's rename event arriving first does the same", () => {
		const { engine, plugin } = setup();
		plugin.followExcludedFolderRename("Old/sub/x.md", "Archive/sub/x.md");
		expect(engine.shouldIgnore("Old/y.md")).toBe(true);
	});

	test("moved under another folder: excluded by its new path", () => {
		const { engine, plugin } = setup();
		plugin.followExcludedFolderRename("Projects/Archive", "Archive");
		expect(engine.shouldIgnore("Projects/Archive/x.md")).toBe(true);
		expect(engine.shouldIgnore("Projects/y.md")).toBe(false);
	});

	test("renaming the folder sends no server delete and no push for files synced before", async () => {
		const { engine, plugin, api } = setup();
		engine.importSyncState({
			"Archive/img.png": { hash: 1, serverHash: "A" },
			"Archive/note.md": { hash: 2, serverHash: "B" },
		});
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;
		// Obsidian's order: the folder, then each child, all after the move.
		plugin.onVaultRename(new TFolder("Old"), "Archive");
		for (const name of ["img.png", "note.md"]) {
			plugin.onVaultRename(new TFile(`Old/${name}`), `Archive/${name}`);
		}
		await Bun.sleep(0);
		expect(api.deleteAttachment).not.toHaveBeenCalled();
		expect(api.deleteNote).not.toHaveBeenCalled();
		expect(pushFile).not.toHaveBeenCalled();
	});

	test("one file moved out of the folder leaves the exclusion alone", () => {
		const { plugin, settings } = setup(["Archive"]); // the folder still exists
		plugin.followExcludedFolderRename("Notes/x.md", "Archive/x.md");
		expect(settings.excludedFolders).toEqual(["Archive"]);
	});
});

describe("Sync again: planFolder then applyFolderPlan settle a folder that was excluded", () => {
	const OLD = new Date("2026-09-01T00:00:00Z").getTime();
	const noteRow = (o: Record<string, unknown>) => ({
		type: "note",
		title: "t",
		folder: "Archive",
		tags: [],
		mtime: 1,
		updated_at: "2026-01-01T00:00:00Z",
		deleted: false,
		...o,
	});
	function setup(files: TFile[], content: Record<string, string>, rows: unknown[]) {
		const built = makeEngine(files, content);
		const { engine, app } = built;
		app.vault.getFileByPath.mockImplementation(
			(p: string) => files.find((f) => f.path === p) ?? null,
		);
		app.vault.getAbstractFileByPath.mockImplementation(
			(p: string) => files.find((f) => f.path === p) ?? null,
		);
		engine.setCrdtLiveCheck(() => true);
		engine.setCrdtCatchupSince(async () => ({
			changes: rows as any,
			has_more: false,
			next_seq: null,
		}));
		return built;
	}

	test("(a) a local edit made while excluded is uploaded", async () => {
		const file = new TFile("Archive/a.md", OLD);
		const { engine } = setup([file], { "Archive/a.md": "# edited" }, [
			noteRow({
				id: "a",
				seq: 5,
				path: "Archive/a.md",
				content: "# synced",
				content_hash: "H1",
			}),
		]);
		engine.importSyncState({
			"Archive/a.md": { hash: fnv1a("# synced"), serverHash: "H1", seq: 5 },
		});
		(engine as any).noteIdMap.set("Archive/a.md", "a");
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		expect(await engine.applyFolderPlan(await engine.planFolder("Archive"))).toEqual({
			failed: 0,
			skipped: 0,
			capped: 0,
		});
		expect(pushFile.mock.calls.map((c: any[]) => c[0].path)).toEqual(["Archive/a.md"]);
	});

	test("(a) edited on both sides: the local text is kept as a conflict copy", async () => {
		const file = new TFile("Archive/a.md", OLD);
		const { engine, app } = setup([file], { "Archive/a.md": "# local edit" }, [
			noteRow({
				id: "a",
				seq: 9,
				path: "Archive/a.md",
				content: "# server edit",
				content_hash: "H2",
			}),
		]);
		engine.importSyncState({
			"Archive/a.md": { hash: fnv1a("# synced"), serverHash: "H1", seq: 5 },
		});
		(engine as any).noteIdMap.set("Archive/a.md", "a");
		(engine as any).pushFile = mock().mockResolvedValue(true);

		await engine.applyFolderPlan(await engine.planFolder("Archive"));

		const written = app.vault.create.mock.calls.map((c: any[]) => c[1]);
		expect(written).toContain("# local edit");
	});

	test("(b) a local delete made while excluded does not come back", async () => {
		const { engine, app } = setup([], {}, [
			noteRow({
				id: "g",
				seq: 5,
				path: "Archive/gone.md",
				content: "# gone",
				content_hash: "H1",
			}),
		]);
		engine.importSyncState({ "Archive/gone.md": { hash: fnv1a("# gone"), serverHash: "H1" } });
		(engine as any).noteIdMap.set("Archive/gone.md", "g");
		(engine as any).crdt.removeDoc = async () => {};
		const enqueued: any[] = [];
		(engine as any).crdtEnqueue = (op: any) => enqueued.push(op);

		await engine.applyFolderPlan(await engine.planFolder("Archive"));

		expect(app.vault.create).not.toHaveBeenCalled();
		expect(enqueued).toEqual([{ kind: "delete", docId: "g", path: "Archive/gone.md" }]);
	});

	test("(c) a server edit made while excluded arrives", async () => {
		const file = new TFile("Archive/s.md", OLD);
		const { engine } = setup([file], { "Archive/s.md": "# synced" }, [
			noteRow({
				id: "s",
				seq: 9,
				path: "Archive/s.md",
				content: "# server edit",
				content_hash: "H2",
			}),
		]);
		engine.importSyncState({
			"Archive/s.md": { hash: fnv1a("# synced"), serverHash: "H1", seq: 5 },
		});
		(engine as any).noteIdMap.set("Archive/s.md", "s");
		const applied: any[] = [];
		const real = engine.applySyncChange.bind(engine);
		(engine as any).applySyncChange = async (c: any) => {
			applied.push(c);
			return real(c);
		};
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;
		// The clean-note converge every catch-up uses (crdt_doc_state, no room).
		const converge = mock(async () => {});
		(engine as any).convergeColdNoteRoomFree = converge;

		await engine.applyFolderPlan(await engine.planFolder("Archive"));

		expect(applied.map((c) => [c.path, c.content])).toEqual([
			["Archive/s.md", "# server edit"],
		]);
		expect(converge.mock.calls.map((c: any[]) => [c[0], c[1]])).toEqual([
			["s", "Archive/s.md"],
		]);
		expect(pushFile).not.toHaveBeenCalled();
	});

	test("(c) a note created on the server while excluded is pulled", async () => {
		const { engine } = setup([], {}, [
			noteRow({
				id: "n",
				seq: 9,
				path: "Archive/new.md",
				content: "# new",
				content_hash: "H",
			}),
		]);
		const applied: string[] = [];
		(engine as any).applySyncChange = async (c: any) => {
			applied.push(c.path);
			return true;
		};
		await engine.applyFolderPlan(await engine.planFolder("Archive"));
		expect(applied).toEqual(["Archive/new.md"]);
	});

	test("other folders are not touched", async () => {
		const other = new TFile("Notes/x.md", OLD);
		const { engine } = setup([other], { "Notes/x.md": "# edited" }, [
			noteRow({ id: "x", seq: 1, path: "Notes/x.md", content: "# old", content_hash: "H1" }),
		]);
		engine.importSyncState({ "Notes/x.md": { hash: fnv1a("# old"), serverHash: "H1" } });
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;
		await engine.applyFolderPlan(await engine.planFolder("Archive"));
		expect(pushFile).not.toHaveBeenCalled();
	});

	test("the deletes shown are exactly the deletes done", async () => {
		const kept = new TFile("Archive/kept.md", OLD);
		const { engine } = setup([kept], { "Archive/kept.md": "# k" }, [
			noteRow({
				id: "g1",
				seq: 1,
				path: "Archive/gone1.md",
				content: "# 1",
				content_hash: "A",
			}),
			noteRow({
				id: "g2",
				seq: 2,
				path: "Archive/gone2.md",
				content: "# 2",
				content_hash: "B",
			}),
			noteRow({
				id: "k",
				seq: 3,
				path: "Archive/kept.md",
				content: "# k",
				content_hash: "C",
			}),
			noteRow({
				id: "s",
				seq: 4,
				path: "Archive/server-only.md",
				content: "# s",
				content_hash: "D",
			}),
		]);
		engine.importSyncState({
			"Archive/gone1.md": { hash: 1, serverHash: "A" },
			"Archive/gone2.md": { hash: 2, serverHash: "B" },
			"Archive/kept.md": { hash: fnv1a("# k"), serverHash: "C" },
		});
		for (const [p, id] of [
			["Archive/gone1.md", "g1"],
			["Archive/gone2.md", "g2"],
		]) {
			(engine as any).noteIdMap.set(p, id);
		}
		(engine as any).crdt.removeDoc = async () => {};
		const deleted: string[] = [];
		(engine as any).crdtEnqueue = (op: any) => deleted.push(op.path);
		(engine as any).applySyncChange = mock(async () => true);

		const plan = await engine.planFolder("Archive");
		const shown = plan.actions.filter((a) => a.kind === "deleteOnServer").map((a) => a.path);
		await engine.applyFolderPlan(plan);

		expect(shown.sort()).toEqual(["Archive/gone1.md", "Archive/gone2.md"]);
		expect(deleted.sort()).toEqual(shown.sort());
	});

	test("a path that changed after the plan is skipped, not acted on blind", async () => {
		const file = new TFile("Archive/a.md", OLD);
		const content = { "Archive/a.md": "# edited" };
		const { engine } = setup([file], content, [
			noteRow({
				id: "a",
				seq: 5,
				path: "Archive/a.md",
				content: "# synced",
				content_hash: "H1",
			}),
		]);
		engine.importSyncState({ "Archive/a.md": { hash: fnv1a("# synced"), serverHash: "H1" } });
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		const plan = await engine.planFolder("Archive");
		content["Archive/a.md"] = "# edited again"; // after the confirm was shown
		file.stat.mtime += 1000; // an edit moves the mtime
		expect(await engine.applyFolderPlan(plan)).toEqual({ failed: 0, skipped: 1, capped: 0 });
		expect(pushFile).not.toHaveBeenCalled();
	});

	test("planning changes nothing and walks the server once", async () => {
		const file = new TFile("Archive/a.md", OLD);
		const { engine, app } = setup([file], { "Archive/a.md": "# edited" }, [
			noteRow({
				id: "a",
				seq: 5,
				path: "Archive/a.md",
				content: "# synced",
				content_hash: "H1",
			}),
		]);
		engine.importSyncState({ "Archive/a.md": { hash: fnv1a("# synced"), serverHash: "H1" } });
		const walks: number[] = [];
		const rows = [
			noteRow({
				id: "a",
				seq: 5,
				path: "Archive/a.md",
				content: "# synced",
				content_hash: "H1",
			}),
		];
		engine.setCrdtCatchupSince(async (since: number) => {
			walks.push(since);
			return { changes: rows as any, has_more: false, next_seq: null };
		});
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		const plan = await engine.planFolder("Archive");
		expect(plan.actions.map((a) => [a.kind, a.path])).toEqual([["upload", "Archive/a.md"]]);
		expect(pushFile).not.toHaveBeenCalled();
		expect(app.vault.create).not.toHaveBeenCalled();
		await engine.applyFolderPlan(plan);
		// One full walk; apply only reads the ops after where it ended.
		expect(walks).toEqual([0, 5]);
	});

	const kinds = (plan: { actions: { kind: string; path: string }[] }) =>
		plan.actions.map((a) => [a.kind, a.path]);

	test("a server edit that lands while the confirm is open: the newest content wins", async () => {
		const file = new TFile("Archive/s.md", OLD);
		const rows: any[] = [
			noteRow({
				id: "s",
				seq: 9,
				path: "Archive/s.md",
				content: "# server 1",
				content_hash: "H2",
			}),
		];
		const { engine } = setup([file], { "Archive/s.md": "# synced" }, []);
		engine.setCrdtCatchupSince(async (since: number) => ({
			changes: rows.filter((r) => r.seq > since),
			has_more: false,
			next_seq: null,
		}));
		engine.importSyncState({
			"Archive/s.md": { hash: fnv1a("# synced"), serverHash: "H1", seq: 5 },
		});
		(engine as any).noteIdMap.set("Archive/s.md", "s");
		const applied: string[] = [];
		(engine as any).applySyncChange = async (c: any) => {
			applied.push(c.content);
			return true;
		};

		const plan = await engine.planFolder("Archive");
		// While the confirm is open the folder is still ignored, so live sync
		// walks past these.
		rows.push(
			noteRow({
				id: "s",
				seq: 12,
				path: "Archive/s.md",
				content: "# server 2",
				content_hash: "H3",
			}),
			noteRow({
				id: "n",
				seq: 13,
				path: "Archive/new.md",
				content: "# new",
				content_hash: "H4",
			}),
		);
		await engine.applyFolderPlan(plan);

		expect(applied).toEqual(["# server 2", "# new"]);
	});

	test("a server rename made while excluded moves the note instead of duplicating it", async () => {
		const file = new TFile("Archive/a.md", OLD);
		const { engine } = setup([file], { "Archive/a.md": "# same" }, [
			noteRow({
				id: "a",
				seq: 9,
				path: "Archive/b.md",
				content: "# same",
				content_hash: "H1",
			}),
		]);
		engine.importSyncState({
			"Archive/a.md": { hash: fnv1a("# same"), serverHash: "H1", seq: 5 },
		});
		(engine as any).noteIdMap.set("Archive/a.md", "a");
		(engine as any).manifestOwnerOf = async () => "a";
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		const plan = await engine.planFolder("Archive");
		expect(kinds(plan)).toEqual([["download", "Archive/b.md"]]);
		await engine.applyFolderPlan(plan);

		expect(pushFile).not.toHaveBeenCalled();
		expect((engine as any).noteIdMap.pathForId("a")).toBe("Archive/b.md");
	});

	test("a server rename plus a local edit: the edit is pushed at the new path", async () => {
		const files = [new TFile("Archive/a.md", OLD)];
		const content: Record<string, string> = { "Archive/a.md": "# edited" };
		const { engine, app } = setup(files, content, [
			noteRow({
				id: "a",
				seq: 9,
				path: "Archive/b.md",
				content: "# synced",
				content_hash: "H1",
			}),
		]);
		app.vault.rename.mockImplementation(async (f: TFile, to: string) => {
			content[to] = content[f.path] ?? "";
			f.path = to;
		});
		engine.importSyncState({
			"Archive/a.md": { hash: fnv1a("# synced"), serverHash: "H1", seq: 5 },
		});
		(engine as any).noteIdMap.set("Archive/a.md", "a");
		(engine as any).manifestOwnerOf = async () => "a";
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		const plan = await engine.planFolder("Archive");
		expect(kinds(plan)).toEqual([["upload", "Archive/b.md"]]);
		await engine.applyFolderPlan(plan);

		expect(pushFile.mock.calls.map((c: any[]) => c[0].path)).toEqual(["Archive/b.md"]);
	});

	test("a server rename onto a path a different local file holds: a conflict, never a new note", async () => {
		const files = [new TFile("Archive/a.md", OLD), new TFile("Archive/b.md", OLD)];
		const { engine, app } = setup(
			files,
			{ "Archive/a.md": "# a edited", "Archive/b.md": "# f" },
			[
				noteRow({
					id: "a",
					seq: 9,
					path: "Archive/b.md",
					content: "# synced",
					content_hash: "H1",
				}),
			],
		);
		engine.importSyncState({
			"Archive/a.md": { hash: fnv1a("# synced"), serverHash: "H1", seq: 5 },
		});
		(engine as any).noteIdMap.set("Archive/a.md", "a");
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;
		(engine as any).applySyncChange = mock(async () => true);

		const plan = await engine.planFolder("Archive");
		expect(plan.actions.some((a) => a.kind === "upload")).toBe(false);
		expect(plan.actions.filter((a) => a.creates)).toEqual([]);
		await engine.applyFolderPlan(plan);

		expect(pushFile).not.toHaveBeenCalled();
		// Both texts survive: the renamed note's local edit and the file at the target.
		const created = app.vault.create.mock.calls.map((c: any[]) => [c[0], c[1]]);
		expect(
			created.some(([p, t]: string[]) => p.includes("(conflict") && t === "# a edited"),
		).toBe(true);
		expect(created.some(([p, t]: string[]) => p.includes("(conflict") && t === "# f")).toBe(
			true,
		);
	});

	test("a server delete with a local edit made while excluded keeps the edit", async () => {
		const file = new TFile("Archive/a.md", OLD);
		const { engine, app } = setup([file], { "Archive/a.md": "# edited" }, [
			noteRow({ id: "a", seq: 9, path: "Archive/a.md", deleted: true }),
		]);
		engine.importSyncState({
			"Archive/a.md": { hash: fnv1a("# synced"), serverHash: "H1", seq: 5 },
		});
		(engine as any).noteIdMap.set("Archive/a.md", "a");
		(engine as any).crdt.removeDoc = async () => {};

		const plan = await engine.planFolder("Archive");
		expect(kinds(plan)).toEqual([["conflict", "Archive/a.md"]]);
		await engine.applyFolderPlan(plan);

		const trashed = [
			...app.vault.trash.mock.calls,
			...app.fileManager.trashFile.mock.calls,
		].some((c: any[]) => c[0] === file);
		const copied = app.vault.create.mock.calls.some((c: any[]) => c[1] === "# edited");
		expect(!trashed || copied).toBe(true);
	});

	test("a local delete with a newer server edit restores the server version", async () => {
		const { engine } = setup([], {}, [
			noteRow({
				id: "g",
				seq: 9,
				path: "Archive/g.md",
				content: "# newer",
				content_hash: "H2",
			}),
		]);
		engine.importSyncState({ "Archive/g.md": { hash: fnv1a("# old"), serverHash: "H1" } });
		(engine as any).noteIdMap.set("Archive/g.md", "g");
		const enqueued: any[] = [];
		(engine as any).crdtEnqueue = (op: any) => enqueued.push(op);
		(engine as any).applySyncChange = mock(async () => true);

		const plan = await engine.planFolder("Archive");
		expect(kinds(plan)).toEqual([["download", "Archive/g.md"]]);
		await engine.applyFolderPlan(plan);
		expect(enqueued).toEqual([]);
	});

	test("an attachment changed only on the server is downloaded", async () => {
		const img = new TFile("Archive/img.png", OLD);
		const { engine, api } = setup([img], {}, [
			{
				type: "attachment",
				id: "i",
				seq: 9,
				path: "Archive/img.png",
				mime_type: "image/png",
				size_bytes: 3,
				mtime: 1,
				updated_at: "2026-01-01T00:00:00Z",
				deleted: false,
			},
		]);
		(api.getManifest as any).mockResolvedValue({
			notes: [],
			attachments: [{ path: "Archive/img.png", content_hash: "A2" }],
		});
		engine.importSyncState({
			"Archive/img.png": { hash: fnv1aBase64(new ArrayBuffer(3)), serverHash: "A1" },
		});

		expect(kinds(await engine.planFolder("Archive"))).toEqual([
			["download", "Archive/img.png"],
		]);
	});

	test("local files are hashed a few at a time, not one by one", async () => {
		const files = Array.from({ length: 12 }, (_, i) => new TFile(`Archive/n${i}.md`, OLD));
		const { engine, app } = setup(files, {}, []);
		let inFlight = 0;
		let most = 0;
		app.vault.cachedRead.mockImplementation(async () => {
			most = Math.max(most, ++inFlight);
			await new Promise((r) => setTimeout(r, 1));
			inFlight--;
			return "# x";
		});
		await engine.planFolder("Archive");
		expect(most).toBeGreaterThan(1);
		expect(most).toBeLessThanOrEqual(16);
	});

	test("apply does not re-read a file whose mtime and size are unchanged", async () => {
		const file = new TFile("Archive/a.md", OLD);
		const { engine, app } = setup([file], { "Archive/a.md": "# edited" }, [
			noteRow({
				id: "a",
				seq: 5,
				path: "Archive/a.md",
				content: "# synced",
				content_hash: "H1",
			}),
		]);
		engine.importSyncState({ "Archive/a.md": { hash: fnv1a("# synced"), serverHash: "H1" } });
		(engine as any).pushFile = mock().mockResolvedValue(true);
		const plan = await engine.planFolder("Archive");
		app.vault.cachedRead.mockClear();
		await engine.applyFolderPlan(plan);
		expect(app.vault.cachedRead).not.toHaveBeenCalled();
	});

	test("server-side steps run a few at a time too", async () => {
		const rows = Array.from({ length: 12 }, (_, i) =>
			noteRow({
				id: `d${i}`,
				seq: i + 1,
				path: `Archive/d${i}.md`,
				content: "# d",
				content_hash: "H",
			}),
		);
		const { engine } = setup([], {}, rows);
		let inFlight = 0;
		let most = 0;
		(engine as any).applySyncChange = async () => {
			most = Math.max(most, ++inFlight);
			await new Promise((r) => setTimeout(r, 1));
			inFlight--;
			return true;
		};
		await engine.applyFolderPlan(await engine.planFolder("Archive"));
		expect(most).toBeGreaterThan(1);
		expect(most).toBeLessThanOrEqual(16);
	});

	test("a vault change during apply stops it before the next action", async () => {
		const { engine } = setup([], {}, [
			noteRow({ id: "x", seq: 1, path: "Archive/x.md", content: "# x", content_hash: "H" }),
			noteRow({ id: "y", seq: 2, path: "Archive/y.md", content: "# y", content_hash: "H" }),
		]);
		const settings = (engine as any).settings;
		settings.vaultId = "v1";
		const applied: string[] = [];
		(engine as any).applySyncChange = async (c: any) => {
			applied.push(c.path);
			settings.vaultId = "v2"; // switched while the first action ran
			return true;
		};
		await expect(engine.applyFolderPlan(await engine.planFolder("Archive"))).rejects.toThrow();
		expect(applied).toHaveLength(1);
	});

	test("a create refused by the notes cap is counted as capped, not failed", async () => {
		const file = new TFile("Archive/new.md", OLD);
		const { engine } = setup([file], { "Archive/new.md": "# n" }, []);
		(engine as any).pushFile = mock(async () => {
			throw new LimitExceededError("notes_cap_reached", null, "notes", 3000, 3000);
		});
		expect(await engine.applyFolderPlan(await engine.planFolder("Archive"))).toEqual({
			failed: 0,
			skipped: 0,
			capped: 1,
		});
	});
});

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
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { TFile } from "obsidian";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { ATTACHMENT_DELETE_CHUNK, AttachmentDeleteBatcher } from "../src/attachment-delete-batcher";
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
import { makeCrdtOpSend } from "../src/crdt-op-dispatch";
import { CrdtOpQueue, MAX_ATTEMPTS, MAX_BACKOFF_MS } from "../src/crdt-op-queue";
import { HELD_DELETE_MAX_AGE_MS, SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
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
	time?: ManualTimeProvider,
): { engine: SyncEngine; app: any; api: EngramApi } {
	const app = makeApp(files, contentByPath);
	const api = makeApi();
	const engine = new SyncEngine(
		app,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
		time,
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
		(engine as any).pushSlots.active = (engine as any).pushSlots.max;

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
		(engine as any).pushSlots.active = (engine as any).pushSlots.max;

		const result = await Promise.race([
			(engine as any).pushFile(file),
			new Promise((r) => setTimeout(() => r("HUNG"), 50)),
		]);

		expect(result).toBe("HUNG");
	});
});

// PR 671 review: a 429 was classified `other`, burned one of RETRY_CAP attempts
// per pass (parking the delete so the server copy survived), ignored
// Retry-After, and replace-remote attachment deletes were logged and dropped.
describe("attachment deletes under a 429 (Retry-After)", () => {
	const rateLimited = () =>
		Object.assign(new Error("Request failed, status 429"), {
			status: 429,
			headers: { "Retry-After": "2" },
		});
	const flushMicro = () => new Promise((r) => setTimeout(r, 0));

	test("replace-remote delete that hits 429 is retried after ~2s, not dropped or parked", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const { engine, api } = makeEngine([], {}, mockCrdt(), time);
		(engine as any).crdtDelete = async (id: string) => ({ doc_id: id });
		(engine as any).pushFile = mock().mockResolvedValue(true);
		(engine as any).catchupViaSeqReplay = async () => ({
			applied: 0,
			serverIds: new Set<string>(),
			serverAttachmentPaths: new Set(["gone.jpg"]),
			ran: true,
			complete: true,
		});
		const calls: number[] = [];
		(api.deleteAttachment as any) = mock(async () => {
			calls.push(time.now());
			// Rate limited for more passes than RETRY_CAP: none may count.
			if (calls.length <= 6) throw rateLimited();
			return { deleted: true, path: "gone.jpg" };
		});

		await engine.pushAll({ replaceRemote: true, localSnapshot: engine.snapshotLocalPaths() });
		expect(calls).toHaveLength(1);
		const entry = (engine as any).queue.all()[0];
		expect(entry.path).toBe("gone.jpg");
		expect(entry.attempts ?? 0).toBe(0); // a 429 consumes no attempt
		expect(entry.nextAttemptAt).toBe(calls[0] + 2_000); // honors Retry-After: 2

		for (let i = 0; i < 6; i++) {
			time.advance(1_999);
			await flushMicro();
			expect(calls).toHaveLength(i + 1); // not before Retry-After
			time.advance(1);
			for (let j = 0; j < 5; j++) await flushMicro();
		}
		expect(calls).toHaveLength(7);
		expect((engine as any).queue.size).toBe(0); // delivered, never parked
		expect((engine as any).issues.all()).toHaveLength(0);
	});
});

// PR 671 adversarial review, sync-engine half. Each fails on 8fbaca0.
describe("rate limits and unload (review M1-M3, M6)", () => {
	const err = (status: number, retryAfter?: string) =>
		Object.assign(new Error(`Request failed, status ${status}`), {
			status,
			headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
		});
	const drainOnce = async (engine: SyncEngine, path: string) => {
		await (engine as any).queue.enqueue({
			path,
			action: "delete",
			kind: "attachment",
			timestamp: 0,
			evidenced: true,
		});
		await engine.flushQueue();
		return (engine as any).queue.all().find((e: any) => e.path === path);
	};

	// M2: the live upload path charged a 429 as a failure (issue, tally, RETRY_CAP).
	test("a 429 on a live attachment push re-queues uncharged, records no issue", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const file = new TFile("img/a.png", Date.now());
		const { engine, api } = makeEngine([file], {}, mockCrdt(), time);
		(api.pushAttachment as any) = mock().mockRejectedValue(err(429, "7"));
		await (engine as any).pushFile(file);
		const entry = (engine as any).queue.all()[0];
		expect(entry?.path).toBe("img/a.png");
		expect(entry.attempts ?? 0).toBe(0);
		expect(entry.nextAttemptAt).toBe(1_000_000 + 7_000);
		expect((engine as any).issues.all()).toHaveLength(0);
		expect((engine as any).failuresThisBatch).toBe(0);
	});

	// M3: Retry-After 0 (or a past date) re-drained at 0 ms, a hot loop.
	test("Retry-After: 0 is floored to 1s", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const { engine, api } = makeEngine([], {}, mockCrdt(), time);
		(api.deleteAttachment as any) = mock().mockRejectedValue(err(429, "0"));
		const entry = await drainOnce(engine, "a.png");
		expect(entry.nextAttemptAt).toBe(1_000_000 + 1_000);
	});

	test("no Retry-After backs off progressively across consecutive 429s", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const { engine, api } = makeEngine([], {}, mockCrdt(), time);
		(api.deleteAttachment as any) = mock().mockRejectedValue(err(429));
		const first = (await drainOnce(engine, "a.png")).nextAttemptAt - time.now();
		time.advance(first);
		await engine.flushQueue();
		const entry = (engine as any).queue.all()[0];
		expect(entry.nextAttemptAt - time.now()).toBe(first * 2);
		expect(entry.attempts ?? 0).toBe(0);
	});

	// M4: a 503 carrying Retry-After parked like any 5xx.
	test("a 503 with Retry-After is honored and never parks", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const { engine, api } = makeEngine([], {}, mockCrdt(), time);
		(api.deleteAttachment as any) = mock().mockRejectedValue(err(503, "60"));
		let entry = await drainOnce(engine, "a.png");
		for (let i = 0; i < 7; i++) {
			time.advance(60_000);
			await engine.flushQueue();
			entry = (engine as any).queue.all()[0];
		}
		expect(entry?.attempts ?? 0).toBe(0);
		expect((engine as any).issues.all()).toHaveLength(0);
	});

	// M1 + delta M3: unload saved only the 100 ms window; chunks queued behind
	// the in-flight one were lost. Real batcher, real offline queue.
	test("unload persists EVERY unacknowledged delete: window, queued chunks, in flight", async () => {
		const { engine, api } = makeEngine([]);
		let release!: () => void;
		const held = new Promise<void>((r) => {
			release = r;
		});
		const batcher = new AttachmentDeleteBatcher({
			send: () => held,
			sendOne: () => held,
			batchEnabled: () => true,
			activeVaultId: () => "v1",
			setTimeout: () => 1,
			clearTimeout: () => {},
		});
		(api as any).attachmentDeletes = batcher;
		const total = 2 * ATTACHMENT_DELETE_CHUNK + 10;
		for (let i = 0; i < total; i++) void batcher.delete(`img/${i}.png`, "v1");
		void batcher.flush(); // chunk 1 in flight, the rest queued
		await new Promise((r) => setTimeout(r, 0));
		const persist = mock(async () => {});
		(engine as any).queue.persist = persist;

		await engine.stashPendingAttachmentDeletes();

		const queued = (engine as any).queue.all();
		expect(queued).toHaveLength(total);
		expect(
			queued.every((e: any) => e.action === "delete" && e.evidenced && e.vaultId === "v1"),
		).toBe(true);
		expect(persist).toHaveBeenCalledTimes(1);
		release();
	});

	/** A real AttachmentDeleteBatcher behind the mock api, wired the way
	 *  EngramApi wires it: deleteAttachment goes through the batcher's vault
	 *  check and settle path, pushAttachment waits on settled(). */
	const realDeletes = (
		api: EngramApi,
		opts: { vault: () => string | null; send?: (paths: string[]) => Promise<void> },
	) => {
		const sent: Array<{ paths: string[]; vaultId: string | null }> = [];
		const batcher = new AttachmentDeleteBatcher({
			send: async (paths, vaultId) => {
				sent.push({ paths, vaultId });
				await opts.send?.(paths);
			},
			sendOne: async () => {},
			batchEnabled: () => true,
			activeVaultId: opts.vault,
			setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as number,
			clearTimeout: (id) => clearTimeout(id),
		});
		const upload = api.pushAttachment as any;
		Object.assign(api as any, {
			attachmentDeletes: batcher,
			deleteAttachment: async (p: string, v?: string | null) => {
				await batcher.delete(p, v ?? null);
				return { deleted: true, path: p };
			},
			pushAttachment: async (p: string, ...rest: unknown[]) => {
				await batcher.settled(p);
				return upload(p, ...rest);
			},
		});
		return { batcher, sent };
	};
	const queuedDelete = (path: string, vaultId: string, timestamp = Date.now()) => ({
		path,
		action: "delete" as const,
		kind: "attachment" as const,
		timestamp,
		vaultId,
		evidenced: true,
	});

	// Delta review M2: a delete made in vault A, still queued when the user
	// switched to B, was DROPPED by the next drain; switching back resurrected it.
	test("a queued delete from another vault is held, then sent when that vault is active", async () => {
		const { engine, api } = makeEngine([]);
		const settings = (engine as any).settings;
		const { sent } = realDeletes(api, { vault: () => settings.vaultId });
		settings.vaultId = "vault-B";
		await (engine as any).queue.enqueue(queuedDelete("img/a.png", "vault-A"));
		await engine.flushQueue();
		expect(sent).toEqual([]);
		expect((engine as any).queue.size).toBe(1);

		settings.vaultId = "vault-A";
		await engine.flushQueue();
		expect(sent).toEqual([{ paths: ["img/a.png"], vaultId: "vault-A" }]);
		expect((engine as any).queue.size).toBe(0);
	});

	// Delta 2 M2: held deletes are not this vault's work.
	test("a held delete does not count as queued, block the ctime sweep or read as waiting", async () => {
		const { engine, app } = makeEngine([]);
		(engine as any).settings.vaultId = "vault-B";
		await (engine as any).queue.enqueue(queuedDelete("img/a.png", "vault-A"));
		expect(engine.getStatus().queued).toBe(0);
		expect(engine.queuedReason()).toBeNull();
		app.vault.getFiles.mockClear();
		await engine.runCtimeSweep();
		expect(app.vault.getFiles).toHaveBeenCalled();
	});

	test("a held delete expires after the age cap, logged", async () => {
		const { engine, api } = makeEngine([]);
		const settings = (engine as any).settings;
		realDeletes(api, { vault: () => settings.vaultId });
		settings.vaultId = "vault-B";
		const old = Date.now() - HELD_DELETE_MAX_AGE_MS - 1;
		await (engine as any).queue.enqueue(queuedDelete("img/old.png", "vault-A", old));
		await (engine as any).queue.enqueue(queuedDelete("img/new.png", "vault-A"));
		await engine.flushQueue();
		expect((engine as any).queue.all().map((e: any) => e.path)).toEqual(["img/new.png"]);
	});

	test("held deletes clear on account change; a deleted vault loses all its entries", async () => {
		const { engine } = makeEngine([]);
		(engine as any).settings.vaultId = "vault-B";
		const q = (engine as any).queue;
		await q.enqueue(queuedDelete("a.png", "vault-A"));
		await q.enqueue(queuedDelete("b.png", "vault-B"));
		engine.dropHeldDeletes("account_changed");
		expect(q.all().map((e: any) => e.path)).toEqual(["b.png"]);
		engine.dropHeldDeletes("vault_deleted", "vault-B");
		expect(q.size).toBe(0);
	});

	// Delta 2 M1: an older upload succeeding cancelled a NEWER delete.
	test("a delete made while an older upload is in flight stays queued and wins", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const file = new TFile("img/x.png", Date.now());
		const { engine, api } = makeEngine([file], {}, mockCrdt(), time);
		const settings = (engine as any).settings;
		settings.vaultId = "v1";
		let release!: () => void;
		(api.pushAttachment as any) = mock(
			() => new Promise((r) => (release = () => r({ attachment: {} }))),
		);
		const { sent } = realDeletes(api, { vault: () => settings.vaultId });
		const upload = (engine as any).pushFile(file);
		await new Promise((r) => setTimeout(r, 5));
		// The user deletes while the upload is in flight (a 429 queued it).
		await (engine as any).queue.enqueue(queuedDelete("img/x.png", "v1", Date.now() + 1));
		release();
		await upload;
		expect((engine as any).queue.all()[0]?.action).toBe("delete");
		await engine.flushQueue();
		expect(sent).toEqual([{ paths: ["img/x.png"], vaultId: "v1" }]);
	});

	test("delete, upload, delete again: the second delete survives the upload", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const file = new TFile("img/x.png", Date.now());
		const { engine, api } = makeEngine([file], {}, mockCrdt(), time);
		const settings = (engine as any).settings;
		settings.vaultId = "v1";
		const q = (engine as any).queue;
		await q.enqueue(queuedDelete("img/x.png", "v1", Date.now() - 10)); // first delete
		let release!: () => void;
		(api.pushAttachment as any) = mock(
			() => new Promise((r) => (release = () => r({ attachment: {} }))),
		);
		realDeletes(api, { vault: () => settings.vaultId });
		const upload = (engine as any).pushFile(file);
		await new Promise((r) => setTimeout(r, 5));
		await q.enqueue(queuedDelete("img/x.png", "v1", Date.now() + 1)); // second delete
		release();
		await upload;
		expect(q.all()[0]?.action).toBe("delete");
	});

	// Delta review M4 (real batcher): a 429'd delete re-queued, then the file
	// was recreated and uploaded; the retry deleted the NEW server copy.
	test("a successful upload supersedes a delete queued before it started", async () => {
		const time = new ManualTimeProvider(1_000_000);
		const file = new TFile("img/x.png", Date.now());
		const { engine, api } = makeEngine([file], {}, mockCrdt(), time);
		const settings = (engine as any).settings;
		settings.vaultId = "v1";
		let first = true;
		const { sent } = realDeletes(api, {
			vault: () => settings.vaultId,
			send: async () => {
				if (first) {
					first = false;
					throw err(429, "5");
				}
			},
		});
		await (engine as any).queue.enqueue(queuedDelete("img/x.png", "v1", Date.now() - 10));
		await engine.flushQueue(); // 429: re-queued for t+5s
		expect((engine as any).queue.all()[0]?.action).toBe("delete");

		await (engine as any).pushFile(file); // recreated and uploaded
		time.advance(10_000);
		await engine.flushQueue();

		expect(sent).toHaveLength(1); // the 429'd attempt only, never retried
		expect((engine as any).queue.all().some((e: any) => e.action === "delete")).toBe(false);
	});

	// PR 2359: the backend replies `delete_failed`; after MAX_ATTEMPTS the CRDT
	// queue dropped the delete silently and the server copy survived.
	test("a CRDT delete that fails MAX_ATTEMPTS times becomes a Sync Center issue", async () => {
		const { engine } = makeEngine([]);
		let t = 0;
		const send = makeCrdtOpSend({
			channel: () =>
				({
					crdtDeleteAcked: () =>
						Promise.reject(new Error('request failed: {"reason":"delete_failed"}')),
				}) as any,
			onCreated: () => {},
			onTerminal: () => {},
		});
		const q = new CrdtOpQueue({
			send,
			now: () => t,
			onDrop: (op, reason) => engine.onCrdtOpDropped(op, reason),
		});
		q.enqueue({
			id: "op1",
			kind: "delete",
			docId: "n1",
			payload: { path: "Notes/gone.md" },
			enqueuedAt: 0,
			attempts: 0,
		});
		await q.onJoined();
		for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
			t += MAX_BACKOFF_MS;
			await q.tick();
		}
		expect(q.size()).toBe(0);
		const issue = (engine as any).issues.get("Notes/gone.md");
		expect(issue?.kind).toBe("note");
		expect(issue?.message).toContain("not delivered");
	});

	// M6: a CRDT delete held past the 60 s cooldown let a fan-out resurrect it.
	test("a fan-out is refused while this device's delete is still queued", async () => {
		const { engine } = makeEngine([]);
		engine.setCrdtHasPendingDelete((id) => id === "n1");
		const pathForId = mock(() => null);
		(engine as any).noteIdMap.pathForId = pathForId;
		const r = await (engine as any).applyPushedNoteUpdateNow("n1", new Uint8Array([0]), "h");
		expect(r).toBe("deferred");
		expect(pathForId).not.toHaveBeenCalled();
	});
});

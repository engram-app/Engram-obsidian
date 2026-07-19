/**
 * Tests: single-write-path genesis push (Task 3). `pushGenesisBatch` routes
 * brand-new (never-server-known) note creates through ONE `crdt_create_batch`
 * round-trip carrying content inline, and both `pushAll` and
 * `pushModifiedFiles` partition their note files into genesis (→ batch) vs
 * server-known (→ the existing per-file `pushFile` loop).
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
import { encodeUpdateFrame, fromB64 } from "../src/crdt/channel";
import { projectNote } from "../src/crdt/frontmatter-codec";
import { CONTENT_KEY, CrdtManager, frontmatterOf, rawFrontmatterOf } from "../src/crdt/manager";
import type { CrdtManager as CrdtManagerType } from "../src/crdt/manager";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { MAX_CRDT_NOTE_BYTES, SyncEngine } from "../src/sync";
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
		getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
		deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
		health: mock().mockResolvedValue(true),
		ping: mock().mockResolvedValue({ ok: true }),
		getManifest: mock().mockResolvedValue(null),
		getAttachmentChanges: mock().mockResolvedValue({
			changes: [],
			server_time: "2026-01-01T00:00:00Z",
		}),
		getRateLimit: mock().mockResolvedValue(0),
		registerVault: mock().mockResolvedValue({
			id: "v1",
			name: "T",
			slug: "t",
			is_default: true,
		}),
	} as unknown as EngramApi;
}

/** A mock CrdtManager sufficient for the genesis-batch path. `encodeGenesisUpdate`
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
		{ ...DEFAULT_SETTINGS, debounceMs: 1, enableCrdt: true },
		mock().mockResolvedValue(undefined),
	);
	engine.setCrdtManager(crdt as unknown as CrdtManagerType);
	engine.setReady();
	engine.setNoteIdMap(new NoteIdMap());
	return { engine, app, api };
}

/** Mark a note server-known: map its path→id and record a crdtHead so the
 *  `hasServerNote` oracle returns true (mirrors the catch-up harness). */
function markServerKnown(engine: SyncEngine, path: string, id: string): void {
	(engine as any).noteIdMap.set(path, id);
	(engine as any).setCrdtHead(path, "srv-head");
}

describe("pushGenesisBatch — direct", () => {
	test("bulk-creates a genesis note, adopts the echoed id, and flips it server-known", async () => {
		const file = new TFile("Notes/Fresh.md", Date.now());
		const { engine } = makeEngine([file], { "Notes/Fresh.md": "# Fresh" });
		let sent: any[] = [];
		// Clean create: the backend echoes the SENT id (Enum.map_reduce, in order).
		engine.setCrdtCreateBatch(async (creates) => {
			sent = creates;
			return { results: creates.map((c) => ({ doc_id: c.doc_id, status: "ok" as const })) };
		});

		const out = await (engine as any).pushGenesisBatch([file]);

		expect(out).toEqual({ pushed: 1, failed: 0 });
		expect(sent).toHaveLength(1);
		expect(sent[0].path).toBe("Notes/Fresh.md");
		expect(typeof sent[0].b64).toBe("string"); // content frame carried inline
		const adopted = sent[0].doc_id;
		expect((engine as any).noteIdMap.get("Notes/Fresh.md")).toBe(adopted);
		// The note is now server-known (crdtHead recorded) so future edits route CRDT.
		expect((engine as any).hasServerNote(adopted)).toBe(true);
	});

	test("id-adoption: an id_conflict (create-race) routes to pushFile for the full ADOPT", async () => {
		// The backend surfaces a create-race as a status:error id_conflict echoing
		// the EXISTING note's id — the single-note pushFile path owns remap+content
		// transfer onto that lineage, so the batch hands the file off to it.
		const file = new TFile("Notes/Race.md", Date.now());
		const { engine } = makeEngine([file], { "Notes/Race.md": "# Race" });
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;
		engine.setCrdtCreateBatch(async (creates) => ({
			results: creates.map(() => ({
				doc_id: "existing-live-id",
				status: "error" as const,
				reason: "id_conflict",
			})),
		}));

		const out = await (engine as any).pushGenesisBatch([file]);

		expect(pushFile).toHaveBeenCalledTimes(1);
		expect(pushFile.mock.calls[0][0]).toBe(file);
		expect(out).toEqual({ pushed: 1, failed: 0 });
	});

	test("mint-refusal (#217): a recently-flushed, id-relocated path is skipped, never batched", async () => {
		const file = new TFile("Notes/Flushed.md", Date.now());
		const { engine } = makeEngine([file], { "Notes/Flushed.md": "# F" });
		// shouldDeferMint = mapped-map + no id for path + path recentlyFlushed.
		(engine as any).recentlyFlushed.set("Notes/Flushed.md", Date.now());
		let called = 0;
		engine.setCrdtCreateBatch(async (creates) => {
			called++;
			return { results: creates.map((c) => ({ doc_id: c.doc_id, status: "ok" as const })) };
		});

		const out = await (engine as any).pushGenesisBatch([file]);

		expect(called).toBe(0); // never sent
		expect(out).toEqual({ pushed: 0, failed: 0 });
	});

	test("delete-wins: a recently_deleted result trashes the local file (converge, not fail)", async () => {
		const file = new TFile("Notes/Gone.md", Date.now());
		const { engine } = makeEngine([file], { "Notes/Gone.md": "# Gone" });
		const trashed: string[] = [];
		(engine as any).trashRemotelyDeleted = async (f: any) => {
			trashed.push(f.path);
		};
		engine.setCrdtCreateBatch(async (creates) => ({
			results: creates.map((c) => ({
				doc_id: c.doc_id,
				status: "error" as const,
				reason: "recently_deleted",
			})),
		}));

		const out = await (engine as any).pushGenesisBatch([file]);

		expect(trashed).toContain("Notes/Gone.md");
		expect(out.failed).toBe(0); // converge, not a failure
	});

	test("an error result records an issue and counts as failed", async () => {
		const file = new TFile("Notes/Bad.md", Date.now());
		const { engine } = makeEngine([file], { "Notes/Bad.md": "# Bad" });
		engine.setCrdtCreateBatch(async (creates) => ({
			results: creates.map((c) => ({
				doc_id: c.doc_id,
				status: "error" as const,
				reason: "notes_cap_reached",
			})),
		}));

		const out = await (engine as any).pushGenesisBatch([file]);

		expect(out.failed).toBe(1);
		expect((engine as any).issues.get("Notes/Bad.md")?.message).toContain("notes_cap_reached");
	});

	test("chunks at 100 notes per crdt_create_batch call (never exceeds the server cap)", async () => {
		const files = Array.from(
			{ length: 250 },
			(_, i) => new TFile(`Notes/n${i}.md`, Date.now()),
		);
		const content = Object.fromEntries(files.map((f) => [f.path, "# n"]));
		const { engine } = makeEngine(files, content);
		const chunkSizes: number[] = [];
		engine.setCrdtCreateBatch(async (creates) => {
			chunkSizes.push(creates.length);
			return { results: creates.map((c) => ({ doc_id: c.doc_id, status: "ok" as const })) };
		});

		const out = await (engine as any).pushGenesisBatch(files);

		expect(chunkSizes).toEqual([100, 100, 50]);
		expect(chunkSizes.every((n) => n <= 100)).toBe(true);
		expect(out.pushed).toBe(250);
	});

	test("an oversized single note routes to pushFile (for the too_large issue), not the batch", async () => {
		const file = new TFile("Notes/Huge.md", Date.now());
		const { engine } = makeEngine([file], { "Notes/Huge.md": "x" });
		// encodeGenesisUpdate returns a frame past the 6MB payload budget.
		(engine as any).crdt.encodeGenesisUpdate = () => new Uint8Array(7_000_000);
		let batchCalled = 0;
		engine.setCrdtCreateBatch(async (creates) => {
			batchCalled++;
			return { results: creates.map((c) => ({ doc_id: c.doc_id, status: "ok" as const })) };
		});
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		const out = await (engine as any).pushGenesisBatch([file]);

		expect(batchCalled).toBe(0); // never entered the batch
		expect(pushFile).toHaveBeenCalledTimes(1);
		expect(pushFile.mock.calls[0][0]).toBe(file);
		expect(out.pushed).toBe(1);
	});

	test("oversized-CONTENT note (exceeds MAX_CRDT_NOTE_BYTES) routes to pushFile, never crdt_create_batch — even though its b64 frame fits well under the payload budget", async () => {
		// Fix (review, Important): the b64-budget check alone lets a note with
		// 4-4.5MB of CONTENT slip into crdt_create_batch when its (mocked,
		// fixed-size) frame is tiny — the client then refuses to CRDT-manage it
		// (every other seam gates on MAX_CRDT_NOTE_BYTES: manager.ts:739,
		// sync.ts:2475/2504/2680), leaving a server-held CRDT room the client's
		// own later edits bypass via legacy REST. Gate on raw content bytes.
		const file = new TFile("Notes/BigContent.md", Date.now());
		const content = "x".repeat(MAX_CRDT_NOTE_BYTES + 1);
		const { engine } = makeEngine([file], { "Notes/BigContent.md": content });
		let batchCalled = 0;
		engine.setCrdtCreateBatch(async (creates) => {
			batchCalled++;
			return { results: creates.map((c) => ({ doc_id: c.doc_id, status: "ok" as const })) };
		});
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		const out = await (engine as any).pushGenesisBatch([file]);

		expect(batchCalled).toBe(0); // never entered crdt_create_batch
		expect(pushFile).toHaveBeenCalledTimes(1);
		expect(pushFile.mock.calls[0][0]).toBe(file);
		expect(out.pushed).toBe(1);
	});

	test("#245: a mid-flight rename during crdt_create_batch is tracked by the snapshotted pushedPath, not the live path", async () => {
		const file = new TFile("Notes/RenameOld.md", Date.now());
		const { engine } = makeEngine([file], { "Notes/RenameOld.md": "# body" });
		const markedPaths: string[] = [];
		(engine as any).markRecentlyPushed = (p: string) => markedPaths.push(p);
		engine.setCrdtCreateBatch(async (creates) => {
			// The user renames the file while the create request is in flight.
			file.path = "Notes/RenameNew.md";
			return { results: creates.map((c) => ({ doc_id: c.doc_id, status: "ok" as const })) };
		});

		const out = await (engine as any).pushGenesisBatch([file]);

		expect(out).toEqual({ pushed: 1, failed: 0 });
		// The pushing-set entry and the recently-pushed mark are keyed to the
		// path actually SENT (pre-rename) — mirrors the REST #245 fix
		// (tests/sync-id-adoption.test.ts) where result matching + state
		// recording use the request-time snapshot, not TFile.path (which is
		// live and would otherwise desync mid-request).
		expect(markedPaths).toEqual(["Notes/RenameOld.md"]);
		expect((engine as any).pushing.has("Notes/RenameOld.md")).toBe(false);
		expect((engine as any).pushing.has("Notes/RenameNew.md")).toBe(false);
	});

	test("no-op when crdtCreateBatch is unwired", async () => {
		const file = new TFile("Notes/x.md", Date.now());
		const { engine } = makeEngine([file], { "Notes/x.md": "# x" });
		const out = await (engine as any).pushGenesisBatch([file]);
		expect(out).toEqual({ pushed: 0, failed: 0 });
	});
});

describe("pushAll / pushModifiedFiles — genesis partition", () => {
	test("server-known notes skip crdt_create_batch (go via the per-file pushFile loop)", async () => {
		const known = new TFile("Notes/Known.md", Date.now());
		const genesis = new TFile("Notes/New.md", Date.now());
		const { engine } = makeEngine([known, genesis], {
			"Notes/Known.md": "# Known",
			"Notes/New.md": "# New",
		});
		markServerKnown(engine, "Notes/Known.md", "id-known");

		const batchCalls: any[] = [];
		engine.setCrdtCreateBatch(async (creates) => {
			batchCalls.push(...creates);
			return { results: creates.map((c) => ({ doc_id: c.doc_id, status: "ok" as const })) };
		});
		const pushFile = mock().mockResolvedValue(true);
		(engine as any).pushFile = pushFile;

		await engine.pushAll({ replaceRemote: false });

		// Only the genesis note reached the batch; the known note did NOT.
		expect(batchCalls.map((c) => c.path)).toEqual(["Notes/New.md"]);
		// The server-known note went through the per-file pushFile loop.
		const pushFilePaths = pushFile.mock.calls.map((c: any[]) => c[0].path);
		expect(pushFilePaths).toContain("Notes/Known.md");
		expect(pushFilePaths).not.toContain("Notes/New.md");
	});

	test("pushModifiedFiles routes a never-synced note through the genesis batch", async () => {
		const genesis = new TFile("Notes/Fresh.md", Date.now());
		const { engine } = makeEngine([genesis], { "Notes/Fresh.md": "# Fresh" });
		const batchCalls: any[] = [];
		engine.setCrdtCreateBatch(async (creates) => {
			batchCalls.push(...creates);
			return { results: creates.map((c) => ({ doc_id: c.doc_id, status: "ok" as const })) };
		});

		await engine.pushModifiedFiles("1970-01-01T00:00:00Z");

		expect(batchCalls.map((c) => c.path)).toEqual(["Notes/Fresh.md"]);
	});
});

describe("encodeGenesisUpdate + encodeUpdateFrame — frame correctness", () => {
	test("the genesis frame reconstructs the exact note content on a fresh peer doc", async () => {
		const mgr = new CrdtManager({
			onUpdate: () => {},
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
		const mgr = new CrdtManager({
			onUpdate: () => {},
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

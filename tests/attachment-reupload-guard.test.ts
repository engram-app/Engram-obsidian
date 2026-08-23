/**
 * Tests: attachments must not be re-uploaded when the server already holds
 * the exact bytes (2026-08-21 prod incident).
 *
 * A single looping client re-uploaded the same 667 attachments for 90 minutes
 * and held prod at ~30% CPU on a 0.5-vCPU task. Server-side dedup now makes
 * that write cheap, but the CLIENT still pays the wire and the server still
 * pays `Base.decode64!` — 30% of all prod CPU in the profile. The only way to
 * avoid both is to not send the bytes.
 *
 * Two paths could re-send unconditionally:
 *  1. The offline-queue drain, which had NO content guard at all.
 *  2. `pushFile(force)`, which deliberately skips the local echo guard.
 *
 * The force case cannot be settled locally: the server's `content_hash` is an
 * HMAC keyed off the user's DEK, which this client never holds (see
 * `FileSyncState.serverHash` — "Never computed locally"). So force proves
 * convergence the only way it can — by comparing the serverHash it RECORDED
 * at upload time against the server's CURRENT hash for that path.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { fnv1a, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const B64 = "AQID";

function makeEngine(overrides: Partial<Record<string, unknown>> = {}) {
	const pushAttachment = mock().mockResolvedValue({
		attachment: { path: "", content_hash: "server-hash-1" },
	});
	const api = {
		pushAttachment,
		deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
		deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
		ping: mock().mockResolvedValue({ ok: true }),
		...overrides,
	} as unknown as EngramApi;

	const app = {
		vault: {
			configDir: ".obsidian",
			read: mock().mockResolvedValue("body"),
			cachedRead: mock().mockResolvedValue("body"),
			readBinary: mock().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
			createBinary: mock().mockResolvedValue(undefined),
			modifyBinary: mock().mockResolvedValue(undefined),
			createFolder: mock().mockResolvedValue(undefined),
			getAbstractFileByPath: mock().mockReturnValue(null),
			getFileByPath: mock().mockReturnValue(null),
			getFiles: mock().mockReturnValue([]),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;

	// NOTE: only four args. The 5th is the TimeProvider, and passing a bare
	// mock there (as some sibling harnesses do) leaves `this.time.setTimeout`
	// undefined — which blows up any path that marks a TTL, e.g. pushFile.
	const e = new SyncEngine(
		app,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	e.setReady();
	e.setNoteIdMap(new NoteIdMap());
	return { e, api, pushAttachment, app };
}

describe("offline-queue drain: attachments", () => {
	test("does NOT re-upload bytes the syncState row already records", async () => {
		const { e, pushAttachment } = makeEngine();
		(e as any).syncState.set("flaky/photo.png", { hash: fnv1a(B64) });

		e.queue.load([
			{
				path: "flaky/photo.png",
				action: "upsert",
				contentBase64: B64,
				mimeType: "image/png",
				mtime: 100,
				kind: "attachment",
				timestamp: 1,
			},
		]);

		await e.flushQueue();

		expect(pushAttachment).not.toHaveBeenCalled();
		// Still settled: an entry we deliberately skip must leave the queue, or
		// it re-drains forever — which is the loop wearing a different hat.
		expect(e.queue.size).toBe(0);
	});

	test("DOES upload when the bytes differ from the recorded row", async () => {
		const { e, pushAttachment } = makeEngine();
		(e as any).syncState.set("flaky/photo.png", { hash: fnv1a("something-else") });

		e.queue.load([
			{
				path: "flaky/photo.png",
				action: "upsert",
				contentBase64: B64,
				mimeType: "image/png",
				mtime: 100,
				kind: "attachment",
				timestamp: 1,
			},
		]);

		await e.flushQueue();

		expect(pushAttachment).toHaveBeenCalledTimes(1);
	});

	test("DOES upload when there is no recorded row at all", async () => {
		const { e, pushAttachment } = makeEngine();

		e.queue.load([
			{
				path: "fresh/photo.png",
				action: "upsert",
				contentBase64: B64,
				mimeType: "image/png",
				mtime: 100,
				kind: "attachment",
				timestamp: 1,
			},
		]);

		await e.flushQueue();

		expect(pushAttachment).toHaveBeenCalledTimes(1);
	});

	test("records the server's content_hash so a later force push can prove convergence", async () => {
		const { e, pushAttachment } = makeEngine();

		e.queue.load([
			{
				path: "fresh/photo.png",
				action: "upsert",
				contentBase64: B64,
				mimeType: "image/png",
				mtime: 100,
				kind: "attachment",
				timestamp: 1,
			},
		]);

		await e.flushQueue();

		expect(pushAttachment).toHaveBeenCalledTimes(1);
		const row = (e as any).syncState.get("fresh/photo.png");
		expect(row.hash).toBe(fnv1a(B64));
		expect(row.serverHash).toBe("server-hash-1");
	});
});

describe("pushFile(force): attachments", () => {
	function attachmentFile(path: string): TFile {
		const f = new TFile(path);
		(f as any).stat = { mtime: 1000, size: 3 };
		return f;
	}

	test("force re-uploads when convergence is UNPROVEN (no recorded serverHash)", async () => {
		const { e, pushAttachment } = makeEngine();
		const file = attachmentFile("a/pic.png");
		// Local bytes unchanged, but we never recorded what the server holds —
		// exactly the case `force` exists for. Re-send.
		(e as any).syncState.set("a/pic.png", { hash: fnv1a(B64) });

		await (e as any).pushFile(file, true);

		expect(pushAttachment).toHaveBeenCalledTimes(1);
	});

	test("force SKIPS when the server's current hash matches the one we recorded", async () => {
		const { e, pushAttachment } = makeEngine();
		const file = attachmentFile("a/pic.png");
		(e as any).syncState.set("a/pic.png", {
			hash: fnv1a(B64),
			serverHash: "server-hash-1",
		});
		// The server's CURRENT hash for this path, as a bulk sweep would supply it.
		const serverHashes = new Map([["a/pic.png", "server-hash-1"]]);

		await (e as any).pushFile(file, true, false, serverHashes);

		expect(pushAttachment).not.toHaveBeenCalled();
	});

	test("force re-uploads when the server's hash has MOVED since we recorded it", async () => {
		const { e, pushAttachment } = makeEngine();
		const file = attachmentFile("a/pic.png");
		(e as any).syncState.set("a/pic.png", {
			hash: fnv1a(B64),
			serverHash: "server-hash-1",
		});
		// Someone else overwrote it server-side — our copy is what should win a
		// force push, so this must NOT skip.
		const serverHashes = new Map([["a/pic.png", "server-hash-2"]]);

		await (e as any).pushFile(file, true, false, serverHashes);

		expect(pushAttachment).toHaveBeenCalledTimes(1);
	});

	test("force re-uploads when the path is absent from the server listing", async () => {
		const { e, pushAttachment } = makeEngine();
		const file = attachmentFile("a/pic.png");
		(e as any).syncState.set("a/pic.png", {
			hash: fnv1a(B64),
			serverHash: "server-hash-1",
		});
		// Not on the server at all — the repair case force is FOR.
		await (e as any).pushFile(file, true, false, new Map());

		expect(pushAttachment).toHaveBeenCalledTimes(1);
	});

	test("WIRING: pushAll fetches the listing and threads it — a converged vault uploads nothing", async () => {
		// The tests above hand pushFile a map directly, which proves the
		// decision but NOT that anything supplies it. Without this, pushAll
		// could pass undefined forever and every test above would still pass
		// while the loop continued in production.
		const getManifest = mock().mockResolvedValue({
			notes: [],
			attachments: [{ path: "a/pic.png", content_hash: "server-hash-1" }],
			total_notes: 0,
			total_attachments: 1,
		});
		const { e, pushAttachment, app } = makeEngine({ getManifest });
		const file = attachmentFile("a/pic.png");
		app.vault.getFiles = mock().mockReturnValue([file]);
		(e as any).isBinaryFile = () => true;
		(e as any).syncState.set("a/pic.png", {
			hash: fnv1a(B64),
			serverHash: "server-hash-1",
		});

		await e.pushAll();

		expect(getManifest).toHaveBeenCalled();
		expect(pushAttachment).not.toHaveBeenCalled();
	});

	test("WIRING: an unavailable listing falls back to re-uploading, never to skipping", async () => {
		// Fail-safe direction: the optimization's input going missing must cost
		// bandwidth, never a skipped upload the server actually needed.
		// Fails the FIRST call only — the pre-push convergence fetch. pushAll
		// makes a second, independent manifest call in its post-push
		// reconcile(), which is unguarded and would throw right past this
		// assertion. (NOT mockRejectedValue: bun builds that rejected promise
		// eagerly, so it lands as an unhandled rejection before it is called.)
		let calls = 0;
		const getManifest = mock(async () => {
			if (++calls === 1) throw new Error("offline");
			return { notes: [], attachments: [], total_notes: 0, total_attachments: 0 };
		});
		const { e, pushAttachment, app } = makeEngine({ getManifest });
		const file = attachmentFile("a/pic.png");
		app.vault.getFiles = mock().mockReturnValue([file]);
		(e as any).isBinaryFile = () => true;
		(e as any).syncState.set("a/pic.png", {
			hash: fnv1a(B64),
			serverHash: "server-hash-1",
		});

		await e.pushAll();

		expect(pushAttachment).toHaveBeenCalledTimes(1);
	});

	test("force re-uploads when local bytes changed, even if the server hash matches", async () => {
		const { e, pushAttachment } = makeEngine();
		const file = attachmentFile("a/pic.png");
		(e as any).syncState.set("a/pic.png", {
			hash: fnv1a("stale-different-bytes"),
			serverHash: "server-hash-1",
		});
		const serverHashes = new Map([["a/pic.png", "server-hash-1"]]);

		await (e as any).pushFile(file, true, false, serverHashes);

		expect(pushAttachment).toHaveBeenCalledTimes(1);
	});
});

describe("inbound attachment events: skip the blob fetch when we already hold the bytes", () => {
	function upsertEvent(extra: Record<string, unknown> = {}) {
		return {
			event_type: "upsert",
			kind: "attachment",
			path: "a/pic.png",
			...extra,
		} as any;
	}

	test("a matching content_hash skips the download entirely", async () => {
		// Engram#961 (1): this was the download mirror of the re-upload loop —
		// a peer that already held the exact bytes still GET the whole blob
		// (possibly many MB) only to byte-compare and discover "unchanged".
		const getAttachment = mock().mockResolvedValue({
			path: "a/pic.png",
			content_base64: "AQID",
			mime_type: "image/png",
			size_bytes: 3,
			mtime: 1,
			updated_at: "",
			content_hash: "server-hash-1",
		});
		const { e } = makeEngine({ getAttachment });
		(e as any).syncState.set("a/pic.png", {
			hash: fnv1a(B64),
			serverHash: "server-hash-1",
		});

		await (e as any).applyStreamEvent(upsertEvent({ content_hash: "server-hash-1" }));

		expect(getAttachment).not.toHaveBeenCalled();
	});

	test("a DIFFERENT content_hash still downloads", async () => {
		const getAttachment = mock().mockResolvedValue({
			path: "a/pic.png",
			content_base64: "AQID",
			mime_type: "image/png",
			size_bytes: 3,
			mtime: 1,
			updated_at: "",
			content_hash: "server-hash-2",
		});
		const { e } = makeEngine({ getAttachment });
		(e as any).syncState.set("a/pic.png", {
			hash: fnv1a(B64),
			serverHash: "server-hash-1",
		});

		await (e as any).applyStreamEvent(upsertEvent({ content_hash: "server-hash-2" }));

		expect(getAttachment).toHaveBeenCalledTimes(1);
	});

	test("an event with NO content_hash still downloads (older backend)", async () => {
		const getAttachment = mock().mockResolvedValue({
			path: "a/pic.png",
			content_base64: "AQID",
			mime_type: "image/png",
			size_bytes: 3,
			mtime: 1,
			updated_at: "",
		});
		const { e } = makeEngine({ getAttachment });
		(e as any).syncState.set("a/pic.png", {
			hash: fnv1a(B64),
			serverHash: "server-hash-1",
		});

		await (e as any).applyStreamEvent(upsertEvent());

		expect(getAttachment).toHaveBeenCalledTimes(1);
	});

	test("receiving an attachment records the server hash, so the NEXT event can skip", async () => {
		// Without this the skip above could never fire on the device that
		// actually received the file — it would hold bytes but no server hash.
		const getAttachment = mock().mockResolvedValue({
			path: "a/pic.png",
			content_base64: "AQID",
			mime_type: "image/png",
			size_bytes: 3,
			mtime: 1,
			updated_at: "",
			content_hash: "server-hash-9",
		});
		const { e } = makeEngine({ getAttachment });

		await (e as any).applyAttachmentChange({
			path: "a/pic.png",
			mime_type: "image/png",
			size_bytes: 3,
			mtime: 1,
			updated_at: "",
			deleted: false,
		});

		expect((e as any).syncState.get("a/pic.png").serverHash).toBe("server-hash-9");
	});
});

describe("a failed post-push reconcile must not fail the push", () => {
	function attachmentFile(path: string): TFile {
		const f = new TFile(path);
		(f as any).stat = { mtime: 1000, size: 3 };
		return f;
	}

	test("pushAll still resolves — and still reports what it pushed", async () => {
		// reconcile() is a post-push REPAIR step: it runs after every file has
		// already been uploaded. Letting its manifest call throw out of pushAll
		// turned a sync that fully succeeded into a reported failure, and the
		// user's natural response to that is to run the push again — which is
		// how a "failure" becomes a re-upload loop.
		const getManifest = mock(async () => {
			throw new Error("manifest unavailable");
		});
		const { e, pushAttachment, app } = makeEngine({ getManifest });
		const file = attachmentFile("a/pic.png");
		app.vault.getFiles = mock().mockReturnValue([file]);
		(e as any).isBinaryFile = () => true;

		const pushed = await e.pushAll();

		expect(pushAttachment).toHaveBeenCalledTimes(1);
		expect(pushed).toBe(1);
	});

	test("reconcile() itself answers null rather than throwing", async () => {
		const getManifest = mock(async () => {
			throw new Error("manifest unavailable");
		});
		const { e } = makeEngine({ getManifest });

		// null is the already-established "could not reconcile" answer (it is
		// what an old backend without a manifest returns), so every caller
		// already handles it.
		expect(await e.reconcile()).toBeNull();
	});
});

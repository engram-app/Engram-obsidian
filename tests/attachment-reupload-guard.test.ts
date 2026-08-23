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

/**
 * Tests: a 410 `blob_missing` on an attachment pull (engram-app/Engram#2159).
 *
 * The server answers 410 + `{code: "blob_missing"}` when a live row lost its
 * stored bytes. That is permanent until someone restores them, so the client
 * must not retry it like a 5xx, and must never touch the local file. When the
 * local copy is provably the bytes the server row describes, re-uploading it
 * heals the server; otherwise the file gets a visible Sync Center issue.
 *
 * "Provably" can only mean server evidence: the row's content_hash is an HMAC
 * this client cannot compute, so the proof is the recorded pair
 * (serverHash, local fnv hash) from the last converge, matched against the
 * row's current content_hash and the file's current bytes.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import {
	categorizeError,
	isBlobMissing,
	issueDisposition,
	shouldRetryAfterFailure,
} from "../src/issue-store";
import { fnv1a, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// base64 of the [1, 2, 3] bytes readBinary returns below.
const B64 = "AQID";
const PATH = "img/photo.png";

/** The rejection shape `throwIfHttpError` builds: status + headers + raw text. */
function httpError(status: number, text: string) {
	return Object.assign(new Error(`Request failed, status ${status}`), {
		status,
		headers: {},
		text,
	});
}
const gone = () =>
	httpError(410, JSON.stringify({ error: "attachment content missing", code: "blob_missing" }));

function makeEngine(getAttachment: () => Promise<unknown>, localFile: TFile | null) {
	const pushAttachment = mock().mockResolvedValue({
		attachment: { path: PATH, content_hash: "server-hash-new" },
	});
	const api = {
		pushAttachment,
		getAttachment: mock(getAttachment),
		ping: mock().mockResolvedValue({ ok: true }),
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
			getAbstractFileByPath: mock().mockReturnValue(localFile),
			getFileByPath: mock().mockReturnValue(localFile),
			getFiles: mock().mockReturnValue(localFile ? [localFile] : []),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	const e = new SyncEngine(
		app,
		api,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	e.setReady();
	e.setNoteIdMap(new NoteIdMap());
	return { e, app, pushAttachment };
}

const change = (content_hash?: string) => ({
	path: PATH,
	mime_type: "image/png",
	size_bytes: 3,
	mtime: 1,
	updated_at: "2026-10-24T00:00:00Z",
	deleted: false,
	...(content_hash ? { content_hash } : {}),
});

function expectLocalUntouched(app: any) {
	expect(app.vault.modifyBinary).not.toHaveBeenCalled();
	expect(app.vault.createBinary).not.toHaveBeenCalled();
	expect(app.fileManager.trashFile).not.toHaveBeenCalled();
}

describe("categorizeError: 410 blob_missing", () => {
	test("is terminal, never retried, and not a 5xx", () => {
		const c = categorizeError(gone());
		expect(c.category).toBe("blob_missing");
		expect(c.terminal).toBe(true);
		expect(shouldRetryAfterFailure(c, 1)).toBe(false);
		expect(issueDisposition(c.category)).toBe("actionable");
		expect(isBlobMissing(gone())).toBe(true);
	});

	test("502 stays a transient server error that retries under the cap", () => {
		const c = categorizeError(httpError(502, JSON.stringify({ error: "storage" })));
		expect(c.category).toBe("server");
		expect(c.terminal).toBe(false);
		expect(shouldRetryAfterFailure(c, 1)).toBe(true);
		expect(isBlobMissing(httpError(502, ""))).toBe(false);
	});

	test("a 410 whose body is not JSON is not blob_missing", () => {
		const err = httpError(410, "<html>Gone</html>");
		expect(isBlobMissing(err)).toBe(false);
		expect(categorizeError(err).category).not.toBe("blob_missing");
	});
});

describe("applyAttachmentChange on 410 blob_missing", () => {
	test("no local file: records a visible issue, no push, no throw", async () => {
		const { e, app, pushAttachment } = makeEngine(() => Promise.reject(gone()), null);

		await expect(e.applyAttachmentChange(change("server-hash-1"))).resolves.toBe(false);

		expect(pushAttachment).not.toHaveBeenCalled();
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
		expect(e.issues.get(PATH)?.kind).toBe("attachment");
		expectLocalUntouched(app);
	});

	test("local bytes differ from the last converge: issue, no push, file untouched", async () => {
		const { e, app, pushAttachment } = makeEngine(
			() => Promise.reject(gone()),
			new TFile(PATH, 1, 3),
		);
		(e as any).syncState.set(PATH, {
			hash: fnv1a("edited-since"),
			serverHash: "server-hash-1",
		});

		await expect(e.applyAttachmentChange(change("server-hash-1"))).resolves.toBe(false);

		expect(pushAttachment).not.toHaveBeenCalled();
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
		expectLocalUntouched(app);
	});

	test("server row moved past our converge: issue, no push (never upload stale bytes)", async () => {
		const { e, pushAttachment } = makeEngine(
			() => Promise.reject(gone()),
			new TFile(PATH, 1, 3),
		);
		(e as any).syncState.set(PATH, { hash: fnv1a(B64), serverHash: "server-hash-OLD" });

		await e.applyAttachmentChange(change("server-hash-1"));

		expect(pushAttachment).not.toHaveBeenCalled();
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
	});

	test("row hash unknown (feed row without content_hash): issue, no push", async () => {
		const { e, pushAttachment } = makeEngine(
			() => Promise.reject(gone()),
			new TFile(PATH, 1, 3),
		);
		(e as any).syncState.set(PATH, { hash: fnv1a(B64), serverHash: "server-hash-1" });

		await e.applyAttachmentChange(change());

		expect(pushAttachment).not.toHaveBeenCalled();
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
	});

	test("local copy matches the row: re-uploads exactly once and records no issue", async () => {
		const { e, app, pushAttachment } = makeEngine(
			() => Promise.reject(gone()),
			new TFile(PATH, 1, 3),
		);
		(e as any).syncState.set(PATH, { hash: fnv1a(B64), serverHash: "server-hash-1" });

		await expect(e.applyAttachmentChange(change("server-hash-1"))).resolves.toBe(false);

		expect(pushAttachment).toHaveBeenCalledTimes(1);
		expect(pushAttachment.mock.calls[0]?.[0]).toBe(PATH);
		expect(e.issues.get(PATH)).toBeUndefined();
		expect((e as any).syncState.get(PATH)?.serverHash).toBe("server-hash-new");
		expectLocalUntouched(app);
	});

	test("the catch-up feed passes the row's content_hash through, so it heals too", async () => {
		const { e, pushAttachment } = makeEngine(
			() => Promise.reject(gone()),
			new TFile(PATH, 1, 3),
		);
		(e as any).syncState.set(PATH, { hash: fnv1a(B64), serverHash: "server-hash-1" });

		await e.applySyncChange({
			type: "attachment",
			id: "a1",
			seq: 7,
			...change("server-hash-1"),
		});

		expect(pushAttachment).toHaveBeenCalledTimes(1);
	});

	test("a later successful download clears the blob_missing issue", async () => {
		let first = true;
		const { e } = makeEngine(() => {
			if (first) {
				first = false;
				return Promise.reject(gone());
			}
			return Promise.resolve({ path: PATH, content_base64: B64, updated_at: "x" });
		}, null);

		await e.applyAttachmentChange(change());
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
		await e.applyAttachmentChange(change());
		expect(e.issues.get(PATH)).toBeUndefined();
	});

	test("502 still throws to the caller (transient) and records nothing here", async () => {
		const { e, app, pushAttachment } = makeEngine(
			() => Promise.reject(httpError(502, JSON.stringify({ error: "storage" }))),
			new TFile(PATH, 1, 3),
		);
		(e as any).syncState.set(PATH, { hash: fnv1a(B64), serverHash: "server-hash-1" });

		await expect(e.applyAttachmentChange(change("server-hash-1"))).rejects.toMatchObject({
			status: 502,
		});
		expect(pushAttachment).not.toHaveBeenCalled();
		expect(e.issues.get(PATH)).toBeUndefined();
		expectLocalUntouched(app);
	});

	test("a non-JSON 410 is not healed: it throws like any other failure", async () => {
		const { e, pushAttachment } = makeEngine(
			() => Promise.reject(httpError(410, "Gone")),
			new TFile(PATH, 1, 3),
		);
		(e as any).syncState.set(PATH, { hash: fnv1a(B64), serverHash: "server-hash-1" });

		await expect(e.applyAttachmentChange(change("server-hash-1"))).rejects.toMatchObject({
			status: 410,
		});
		expect(pushAttachment).not.toHaveBeenCalled();
	});
});

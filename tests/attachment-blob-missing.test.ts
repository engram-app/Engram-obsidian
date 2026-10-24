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
 *
 * The server side is modelled by `fakeServer`, which follows backend PR
 * engram-app/Engram#2160's contract (commit aa5df60d8, `identical_or_changed`
 * checks `blob_present?`): a GET of a live row whose blob is gone
 * answers 410 blob_missing; an upload of identical bytes onto that row writes
 * the blob under a fresh key (`attachment blob healed from client`) and
 * answers with the SAME content_hash, because the hash is an HMAC of the
 * plaintext. The response carries no "healed" flag, so the client confirms
 * with a GET. `heals: false` models a backend without the heal (identical
 * upload short-circuits, the blob stays gone): the client must notice via
 * its follow-up GET.
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
import { BLOB_HEAL_PUSHES_PER_PASS, fnv1a, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// base64 of the [1, 2, 3] bytes readBinary returns below.
const B64 = "AQID";
const PATH = "img/photo.png";
const ROW_HASH = "server-hash-1";

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

/** One attachment row per path, each with a content_hash and a blob that may
 *  be missing. See the file header for the contract it follows. */
function fakeServer(paths: string[], opts: { heals: boolean }) {
	const blobPresent = new Map(paths.map((p) => [p, false]));
	const getAttachment = mock(async (path: string) => {
		if (!blobPresent.get(path)) throw gone();
		return { path, content_base64: B64, content_hash: ROW_HASH, updated_at: "x" };
	});
	const pushAttachment = mock(async (path: string) => {
		if (opts.heals) blobPresent.set(path, true);
		return { attachment: { path, content_hash: ROW_HASH } };
	});
	return { blobPresent, getAttachment, pushAttachment };
}

function makeEngine(
	server: { getAttachment: unknown; pushAttachment: unknown },
	localFiles: TFile[],
) {
	const api = {
		pushAttachment: server.pushAttachment,
		getAttachment: server.getAttachment,
		ping: mock().mockResolvedValue({ ok: true }),
	} as unknown as EngramApi;
	const byPath = new Map(localFiles.map((f) => [f.path, f]));
	const app = {
		vault: {
			configDir: ".obsidian",
			read: mock().mockResolvedValue("body"),
			cachedRead: mock().mockResolvedValue("body"),
			readBinary: mock().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
			createBinary: mock().mockResolvedValue(undefined),
			modifyBinary: mock().mockResolvedValue(undefined),
			createFolder: mock().mockResolvedValue(undefined),
			getAbstractFileByPath: mock((p: string) => byPath.get(p) ?? null),
			getFileByPath: mock((p: string) => byPath.get(p) ?? null),
			getFiles: mock().mockReturnValue(localFiles),
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
	return { e, app };
}

/** Record the row a previous converge left behind: our bytes, the row's hash. */
function synced(e: SyncEngine, path: string, hash = fnv1a(B64), serverHash = ROW_HASH) {
	(e as any).syncState.set(path, { hash, serverHash });
}

const change = (content_hash?: string, path = PATH) => ({
	path,
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
		const server = fakeServer([PATH], { heals: true });
		const { e, app } = makeEngine(server, []);

		await expect(e.applyAttachmentChange(change(ROW_HASH))).resolves.toBe(false);

		expect(server.pushAttachment).not.toHaveBeenCalled();
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
		expect(e.issues.get(PATH)?.kind).toBe("attachment");
		expectLocalUntouched(app);
	});

	test("local bytes differ from the last converge: issue, no push, file untouched", async () => {
		const server = fakeServer([PATH], { heals: true });
		const { e, app } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		synced(e, PATH, fnv1a("edited-since"));

		await expect(e.applyAttachmentChange(change(ROW_HASH))).resolves.toBe(false);

		expect(server.pushAttachment).not.toHaveBeenCalled();
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
		expectLocalUntouched(app);
	});

	test("server row moved past our converge: issue, no push (never upload stale bytes)", async () => {
		const server = fakeServer([PATH], { heals: true });
		const { e } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		synced(e, PATH, fnv1a(B64), "server-hash-OLD");

		await e.applyAttachmentChange(change(ROW_HASH));

		expect(server.pushAttachment).not.toHaveBeenCalled();
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
	});

	test("row hash unknown (feed row without content_hash): issue, no push", async () => {
		const server = fakeServer([PATH], { heals: true });
		const { e } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		synced(e, PATH);

		await e.applyAttachmentChange(change());

		expect(server.pushAttachment).not.toHaveBeenCalled();
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
	});

	test("healing backend: one push, the follow-up GET proves the blob is back, no issue", async () => {
		const server = fakeServer([PATH], { heals: true });
		const { e, app } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		synced(e, PATH);

		await expect(e.applyAttachmentChange(change(ROW_HASH))).resolves.toBe(false);

		expect(server.pushAttachment).toHaveBeenCalledTimes(1);
		expect(server.blobPresent.get(PATH)).toBe(true);
		// The original GET, then the confirming one.
		expect(server.getAttachment).toHaveBeenCalledTimes(2);
		expect(e.issues.get(PATH)).toBeUndefined();
		expect((e as any).syncState.get(PATH)?.serverHash).toBe(ROW_HASH);
		expectLocalUntouched(app);
	});

	test("backend that does not heal: the push is not trusted, issue recorded, row unchanged", async () => {
		const server = fakeServer([PATH], { heals: false });
		const { e, app } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		synced(e, PATH, fnv1a(B64), ROW_HASH);
		const before = { ...(e as any).syncState.get(PATH) };

		await e.applyAttachmentChange(change(ROW_HASH));

		expect(server.pushAttachment).toHaveBeenCalledTimes(1);
		expect(server.blobPresent.get(PATH)).toBe(false);
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
		const after = (e as any).syncState.get(PATH);
		expect(after.hash).toBe(before.hash);
		expect(after.serverHash).toBe(before.serverHash);
		expectLocalUntouched(app);
	});

	test("never heals the same row twice, even across a reload", async () => {
		const server = fakeServer([PATH], { heals: false });
		const { e } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		synced(e, PATH);

		await e.applyAttachmentChange(change(ROW_HASH));
		const persisted = e.exportSyncState();
		const { e: reloaded } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		reloaded.importSyncState(persisted);
		await reloaded.applyAttachmentChange(change(ROW_HASH));

		expect(server.pushAttachment).toHaveBeenCalledTimes(1);
		expect(reloaded.issues.get(PATH)?.category).toBe("blob_missing");
	});

	test("a replay of N proven files pushes each at most once across two passes, capped per pass", async () => {
		const n = BLOB_HEAL_PUSHES_PER_PASS + 3;
		const paths = Array.from({ length: n }, (_, i) => `img/p${i}.png`);
		const server = fakeServer(paths, { heals: false });
		const { e } = makeEngine(
			server,
			paths.map((p) => new TFile(p, 1, 3)),
		);
		for (const p of paths) synced(e, p);

		for (let pass = 0; pass < 2; pass++) {
			(e as any).beginBlobHealPass();
			for (const p of paths) await e.applyAttachmentChange(change(ROW_HASH, p));
			if (pass === 0) {
				expect(server.pushAttachment).toHaveBeenCalledTimes(BLOB_HEAL_PUSHES_PER_PASS);
			}
		}

		expect(server.pushAttachment).toHaveBeenCalledTimes(n);
		const pushed = server.pushAttachment.mock.calls.map((c) => c[0]);
		expect(new Set(pushed).size).toBe(n);
		for (const p of paths) expect(e.issues.get(p)?.category).toBe("blob_missing");
	});

	test("a push already in flight for the path still leaves a visible issue", async () => {
		const server = fakeServer([PATH], { heals: true });
		const { e } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		synced(e, PATH);
		(e as any).pushing.add(PATH);

		await e.applyAttachmentChange(change(ROW_HASH));

		expect(server.pushAttachment).not.toHaveBeenCalled();
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
	});

	test("the catch-up feed passes the row's content_hash through, so it heals too", async () => {
		const server = fakeServer([PATH], { heals: true });
		const { e } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		synced(e, PATH);

		await e.applySyncChange({ type: "attachment", id: "a1", seq: 7, ...change(ROW_HASH) });

		expect(server.pushAttachment).toHaveBeenCalledTimes(1);
		expect(server.blobPresent.get(PATH)).toBe(true);
	});

	test("live path: an upsert carrying the synced hash is hash-skipped, so it never GETs or heals", async () => {
		const server = fakeServer([PATH], { heals: true });
		const { e } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		synced(e, PATH);

		await e.handleStreamEvent({
			event_type: "upsert",
			kind: "attachment",
			path: PATH,
			timestamp: 1,
			content_hash: ROW_HASH,
		});

		expect(server.getAttachment).not.toHaveBeenCalled();
		expect(server.pushAttachment).not.toHaveBeenCalled();
	});

	test("a later successful download clears the blob_missing issue", async () => {
		const server = fakeServer([PATH], { heals: true });
		const { e } = makeEngine(server, []);

		await e.applyAttachmentChange(change());
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
		server.blobPresent.set(PATH, true);
		await e.applyAttachmentChange(change());
		expect(e.issues.get(PATH)).toBeUndefined();
	});

	test("the issue survives a download whose local write fails", async () => {
		const server = fakeServer([PATH], { heals: true });
		const { e, app } = makeEngine(server, []);
		await e.applyAttachmentChange(change());
		server.blobPresent.set(PATH, true);
		app.vault.createBinary.mockRejectedValueOnce(new Error("disk full"));

		await expect(e.applyAttachmentChange(change())).rejects.toThrow("disk full");
		expect(e.issues.get(PATH)?.category).toBe("blob_missing");
	});

	test("502 still throws to the caller (transient) and records nothing here", async () => {
		const server = fakeServer([PATH], { heals: true });
		server.getAttachment.mockImplementation(() =>
			Promise.reject(httpError(502, JSON.stringify({ error: "storage" }))),
		);
		const { e, app } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		synced(e, PATH);

		await expect(e.applyAttachmentChange(change(ROW_HASH))).rejects.toMatchObject({
			status: 502,
		});
		expect(server.pushAttachment).not.toHaveBeenCalled();
		expect(e.issues.get(PATH)).toBeUndefined();
		expectLocalUntouched(app);
	});

	test("a non-JSON 410 is not healed: it throws like any other failure", async () => {
		const server = fakeServer([PATH], { heals: true });
		server.getAttachment.mockImplementation(() => Promise.reject(httpError(410, "Gone")));
		const { e } = makeEngine(server, [new TFile(PATH, 1, 3)]);
		synced(e, PATH);

		await expect(e.applyAttachmentChange(change(ROW_HASH))).rejects.toMatchObject({
			status: 410,
		});
		expect(server.pushAttachment).not.toHaveBeenCalled();
	});
});

/** wipeRemote self-echo suppression (2026-07-08 vault-wipe incident).
 *
 *  "Delete all on remote, then upload local files" (pushAll replaceRemote)
 *  REST-deletes every remote note while the WS channel stays connected. The
 *  server fans each delete back to the deleting device (no origin
 *  attribution), and the stream handler deliberately exempts deletes from
 *  push-echo suppression — so the plugin trashed its own local vault before
 *  the upload phase enumerated files. Both sides ended up empty.
 *
 *  Contract pinned here:
 *   1. a WS delete for a path wipeRemote itself just deleted is SKIPPED
 *      (never trashFile) — it is our own echo, not a remote intent;
 *   2. the suppression is scoped: deletes for other paths still apply;
 *   3. for a wiped EXTRA, wipeRemote clears the path's server bindings
 *      (syncState, noteIdMap, CRDT doc + enrollment) so the follow-up pushAll
 *      re-mints it as new instead of hash-skipping an "unchanged" note into
 *      remote loss. (Notes present locally are no longer wiped — they are
 *      force-pushed in place; see the "preserves locally-present notes" test.)
 */

import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { SyncEngine, fnv1a } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApi = {
	ping: mock().mockResolvedValue({ ok: true }),
	health: mock().mockResolvedValue(true),
	deleteNote: mock().mockResolvedValue({ deleted: true, path: "" }),
	deleteAttachment: mock().mockResolvedValue({ deleted: true, path: "" }),
	getManifest: mock().mockResolvedValue(null),
	getNote: mock().mockResolvedValue(null),
	getChanges: mock().mockResolvedValue({ changes: [], server_time: "2026-01-01T00:00:00Z" }),
	getSyncChanges: mock().mockResolvedValue({ changes: [], next_cursor: null, has_more: false }),
	getAttachmentChanges: mock().mockResolvedValue({
		changes: [],
		server_time: "2026-01-01T00:00:00Z",
	}),
	pushNote: mock().mockResolvedValue({ note: {}, chunks_indexed: 1 }),
	pushNotesBatch: mock().mockRejectedValue({ status: 404 }),
	pushAttachment: mock().mockResolvedValue({ attachment: {} }),
	getRateLimit: mock().mockResolvedValue(0),
} as unknown as EngramApi;

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("# Test"),
		cachedRead: mock().mockResolvedValue("# Test"),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null) as jest.Mock,
		modify: mock().mockResolvedValue(undefined),
		create: mock().mockResolvedValue(undefined),
		createFolder: mock().mockResolvedValue(undefined),
		trash: mock().mockResolvedValue(undefined),
		rename: mock().mockReturnValue(undefined),
		getName: mock().mockReturnValue("Test Vault"),
	},
	fileManager: {
		trashFile: mock().mockResolvedValue(undefined),
	},
	workspace: {
		getActiveViewOfType: mock().mockReturnValue(null),
	},
} as any;

type EnginePrivates = {
	wipeRemote(localSnapshot?: Set<string>): Promise<void>;
	syncState: Map<string, unknown>;
};

function createEngine(noteIdMap: NoteIdMap = new NoteIdMap()): SyncEngine {
	const engine = new SyncEngine(
		mockApp,
		mockApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setReady();
	engine.setNoteIdMap(noteIdMap);
	return engine;
}

function priv(engine: SyncEngine): EnginePrivates {
	return engine as unknown as EnginePrivates;
}

function identityNoteIdMap(...paths: string[]): NoteIdMap {
	const m = new NoteIdMap();
	for (const p of paths) m.set(p, p);
	return m;
}

beforeEach(() => {
	jest.clearAllMocks();
	mockApp.vault.getFileByPath.mockReset().mockReturnValue(null);
	mockApp.vault.getFiles.mockReset().mockReturnValue([]);
	(mockApi.getManifest as jest.Mock).mockReset().mockResolvedValue(null);
	(mockApi.deleteNote as jest.Mock).mockReset().mockResolvedValue({ deleted: true, path: "" });
});

function manifestWith(notePaths: string[], attachmentPaths: string[] = []) {
	(mockApi.getManifest as jest.Mock).mockResolvedValue({
		notes: notePaths.map((path) => ({ path, content_hash: "h" })),
		attachments: attachmentPaths.map((path) => ({ path, content_hash: "h" })),
	});
}

describe("wipeRemote self-echo suppression", () => {
	test("WS delete echo for a wiped path is skipped — local file survives", async () => {
		const engine = createEngine();
		manifestWith(["Notes/Keep.md"]);

		await priv(engine).wipeRemote();
		expect(mockApi.deleteNote).toHaveBeenCalledWith("Notes/Keep.md");

		// The server's fanout of OUR delete comes back on the stream.
		mockApp.vault.getFileByPath.mockReturnValueOnce(new TFile("Notes/Keep.md"));
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/Keep.md",
			timestamp: 1709345678,
		});

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("attachment delete echo for a wiped path is skipped too", async () => {
		const engine = createEngine();
		manifestWith([], ["Assets/pic.png"]);

		await priv(engine).wipeRemote();
		expect(mockApi.deleteAttachment).toHaveBeenCalledWith("Assets/pic.png");

		mockApp.vault.getFileByPath.mockReturnValueOnce(new TFile("Assets/pic.png"));
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Assets/pic.png",
			timestamp: 1709345678,
		});

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("scoped: a delete for a path we did NOT wipe still applies", async () => {
		const engine = createEngine();
		manifestWith(["Notes/Keep.md"]);
		await priv(engine).wipeRemote();

		// A genuine remote delete (another device) for an unrelated path.
		const other = new TFile("Notes/Other.md");
		mockApp.vault.getFileByPath.mockReturnValueOnce(other);
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/Other.md",
			timestamp: 1709345678,
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(other);
	});

	test("delete event carrying our OWN device_id is dropped (#970)", async () => {
		const engine = createEngine();
		engine.setDeviceId("device-self");

		mockApp.vault.getFileByPath.mockReturnValueOnce(new TFile("Notes/Mine.md"));
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/Mine.md",
			timestamp: 1709345678,
			device_id: "device-self",
		});

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
	});

	test("delete event from a FOREIGN device still applies (#970)", async () => {
		const engine = createEngine();
		engine.setDeviceId("device-self");

		const file = new TFile("Notes/Theirs.md");
		mockApp.vault.getFileByPath.mockReturnValueOnce(file);
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/Theirs.md",
			timestamp: 1709345678,
			device_id: "device-other",
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(file);
	});

	test("foreign-attributed delete for a wiped path STILL applies (review F2)", async () => {
		// Device B legitimately deletes a path A just wiped: the event carries
		// B's device_id, so it is provably not A's echo — suppressing it would
		// resurrect the note on A's next push.
		const engine = createEngine();
		engine.setDeviceId("device-self");
		manifestWith(["Notes/Keep.md"]);
		await priv(engine).wipeRemote();

		const file = new TFile("Notes/Keep.md");
		mockApp.vault.getFileByPath.mockReturnValueOnce(file);
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/Keep.md",
			timestamp: 1709345678,
			device_id: "device-other",
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(file);
	});

	test("bindings are cleared even when the REST delete rejects (review F1)", async () => {
		// A client-side timeout can mask a delete that actually landed. Retained
		// bindings would crdt-skip/hash-skip the re-push and the tombstone pull
		// would trash the local file — clear them regardless of REST outcome.
		const noteIdMap = identityNoteIdMap("Notes/Keep.md");
		const engine = createEngine(noteIdMap);
		priv(engine).syncState.set("Notes/Keep.md", {
			hash: 1,
			mtime: 1,
			serverHash: "h",
			version: 1,
		});
		manifestWith(["Notes/Keep.md"]);
		(mockApi.deleteNote as jest.Mock).mockRejectedValueOnce(new Error("timeout"));

		await priv(engine).wipeRemote();

		expect(priv(engine).syncState.get("Notes/Keep.md")).toBeUndefined();
		expect(noteIdMap.get("Notes/Keep.md")).toBeNull();
	});

	test("canvas noteIdMap entries are cleared too, not just .md (review F4)", async () => {
		const noteIdMap = identityNoteIdMap("Boards/Plan.canvas");
		const engine = createEngine(noteIdMap);
		manifestWith(["Boards/Plan.canvas"]);

		await priv(engine).wipeRemote();

		expect(noteIdMap.get("Boards/Plan.canvas")).toBeNull();
	});

	test("editor bindings are detached BEFORE any doc teardown (review F3)", async () => {
		const noteIdMap = identityNoteIdMap("Notes/Open.md");
		const engine = createEngine(noteIdMap);
		const order: string[] = [];
		const crdt = {
			removeDoc: mock(async () => {
				order.push("removeDoc");
			}),
			applyLocalEdit: mock(async (_id: string, c: string) => c),
		};
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEditorDetach(() => {
			order.push("detach");
		});
		manifestWith(["Notes/Open.md"]);

		await priv(engine).wipeRemote();

		expect(order[0]).toBe("detach");
		expect(order).toContain("removeDoc");
	});

	test("remote-applied trash does NOT push a DELETE back to the server (CI find)", async () => {
		// B applies A's delete (trashFile) → Obsidian fires vault.on('delete') →
		// handleDelete previously re-pushed api.deleteNote(path). Path-keyed and
		// CAS-less, that echo-push kills a note recreated at the path in between
		// (wipe→re-push on A) — test_86's settle assert caught it on CI.
		const engine = createEngine();
		const file = new TFile("Notes/FromRemote.md");
		mockApp.vault.getFileByPath.mockReturnValueOnce(file);
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/FromRemote.md",
			timestamp: 1709345678,
			device_id: "device-other",
		});
		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(file);

		// Obsidian's vault 'delete' event for that trash lands in handleDelete.
		await engine.handleDelete(file);

		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});

	test("a genuine user-initiated delete of a synced note enqueues a socket delete (no REST)", async () => {
		// CRDT-authoritative rewire: a local delete of a note the server knows
		// (a resolvable note_id) hands off a durable crdt_delete over the socket
		// instead of a REST api.deleteNote.
		const map = identityNoteIdMap("Notes/UserDeleted.md");
		const engine = createEngine(map);
		const enqueued: unknown[] = [];
		engine.setCrdtEnqueue((op) => {
			enqueued.push(op);
		});
		const file = new TFile("Notes/UserDeleted.md");

		await engine.handleDelete(file);

		expect(enqueued).toEqual([
			{ kind: "delete", docId: "Notes/UserDeleted.md", path: "Notes/UserDeleted.md" },
		]);
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});

	test("wipeRemote clears server bindings so the re-push mints fresh", async () => {
		const noteIdMap = identityNoteIdMap("Notes/Keep.md");
		const engine = createEngine(noteIdMap);
		const crdt = {
			removeDoc: mock(async () => {}),
			applyLocalEdit: mock(async (_id: string, c: string) => c),
		};
		const enrollment = { enroll: mock(), reset: mock() };
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		// Simulate an in-sync note: stored serverHash would let the follow-up
		// pushAll skip the file as "unchanged" — after a wipe that means the
		// note silently stays deleted on the server.
		priv(engine).syncState.set("Notes/Keep.md", {
			hash: 1,
			mtime: 1,
			serverHash: "h",
			version: 1,
		});

		manifestWith(["Notes/Keep.md"]);
		await priv(engine).wipeRemote();

		expect(priv(engine).syncState.get("Notes/Keep.md")).toBeUndefined();
		expect(noteIdMap.get("Notes/Keep.md")).toBeNull();
		expect(crdt.removeDoc).toHaveBeenCalledWith("Notes/Keep.md");
		expect(enrollment.reset).toHaveBeenCalledWith("Notes/Keep.md");
	});
});

describe("wipeRemote preserves locally-present notes (delete-wins regression)", () => {
	// Root cause of e2e test_86 breaking on the delete-wins branch: replaceRemote
	// deleted EVERY remote note (incl. ones about to be re-uploaded), then the
	// backend delete-wins tombstone refused the same-path re-push as
	// `recently_deleted` → the note stayed 404. A note present locally must NOT
	// be deleted during the wipe — the follow-up force-push updates it in place
	// (no tombstone → guard never fires, CRDT room preserved). Only true remote
	// extras (absent locally) get wiped.
	test("deletes only remote-only extras; keeps notes present in the local vault", async () => {
		const idMap = identityNoteIdMap("Notes/Keep.md");
		const engine = createEngine(idMap);
		manifestWith(["Notes/Keep.md", "Notes/RemoteOnly.md"]);
		// Keep.md exists locally; RemoteOnly.md does not.
		mockApp.vault.getFiles.mockReturnValue([new TFile("Notes/Keep.md")]);

		await priv(engine).wipeRemote();

		// The remote-only extra is deleted.
		expect(mockApi.deleteNote).toHaveBeenCalledWith("Notes/RemoteOnly.md");
		// A note that exists locally is NOT deleted (would tombstone the path).
		expect(mockApi.deleteNote).not.toHaveBeenCalledWith("Notes/Keep.md");
		// Its id binding is retained so the re-push updates by id in place.
		expect(idMap.get("Notes/Keep.md")).toBe("Notes/Keep.md");
	});
});

describe("wipeRemote pre-gate local snapshot (test_86 gate-open race)", () => {
	// push-all-delete-remote runs markSyncGateAccepted() BEFORE wipeRemote. The
	// gate-open delivers queued live WS events into the vault, so a server-only
	// note (RemoteOnly) can land locally BEFORE wipeRemote reads getFiles() — it
	// then looks "local" and dodges the wipe (server proof: the only DELETE came
	// ~30s later). Passing a snapshot of local paths captured BEFORE the gate
	// opened makes the wipe use the pre-sync truth: a race-injected note is still
	// a remote extra (wiped), while genuinely-local files are kept.
	test("a race-injected note (in the vault but NOT in the snapshot) is still wiped", async () => {
		const engine = createEngine();
		manifestWith(["Notes/RemoteOnly.md", "Notes/LocalOnly.md"]);
		// The vault currently holds BOTH — RemoteOnly was live-delivered by the
		// gate-open race after the snapshot was taken.
		mockApp.vault.getFiles.mockReturnValue([
			new TFile("Notes/RemoteOnly.md"),
			new TFile("Notes/LocalOnly.md"),
		]);
		// Pre-gate snapshot: only LocalOnly was truly local; RemoteOnly was remote-only.
		const snapshot = new Set(["Notes/LocalOnly.md"]);

		await priv(engine).wipeRemote(snapshot);

		// Race-injected remote note is wiped despite being in the vault now.
		expect(mockApi.deleteNote).toHaveBeenCalledWith("Notes/RemoteOnly.md");
		// Genuinely-local file is kept (no tombstone → no delete-wins 404).
		expect(mockApi.deleteNote).not.toHaveBeenCalledWith("Notes/LocalOnly.md");
	});

	test("without a snapshot, falls back to current getFiles() (unchanged behavior)", async () => {
		const engine = createEngine();
		manifestWith(["Notes/Extra.md", "Notes/Local.md"]);
		mockApp.vault.getFiles.mockReturnValue([new TFile("Notes/Local.md")]);

		await priv(engine).wipeRemote();

		expect(mockApi.deleteNote).toHaveBeenCalledWith("Notes/Extra.md");
		expect(mockApi.deleteNote).not.toHaveBeenCalledWith("Notes/Local.md");
	});

	test("pushAll(replaceRemote, snapshot) does NOT re-push a race-injected note", async () => {
		const engine = createEngine();
		manifestWith(["Notes/RemoteOnly.md"]);
		// Vault holds the race-injected RemoteOnly plus a genuinely-local file.
		mockApp.vault.getFiles.mockReturnValue([
			new TFile("Notes/RemoteOnly.md"),
			new TFile("Notes/LocalOnly.md"),
		]);

		await engine.pushAll({
			replaceRemote: true,
			localSnapshot: new Set(["Notes/LocalOnly.md"]),
		});

		// Wiped as an extra, and NOT re-pushed (would resurrect it / 404).
		expect(mockApi.deleteNote).toHaveBeenCalledWith("Notes/RemoteOnly.md");
		const pushedPaths = (mockApi.pushNote as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
		expect(pushedPaths).not.toContain("Notes/RemoteOnly.md");
	});

	test("reconcile does NOT resurrect a race-injected note even when getFileByPath resolves it", async () => {
		// The prior test only proves the MAIN push loop skips the race note — it
		// leaves the vault's getFileByPath at the beforeEach null, so reconcile's
		// re-push loop is a no-op. reconcile re-enumerates getFiles() and re-pushes
		// "missing" paths via pushFile(); this test resolves the race file there so
		// the reconcile fence (not just the main-loop filter) is what's asserted.
		const engine = createEngine();
		// Manifest lacks RemoteOnly (wiped) → reconcile classifies it "missing".
		manifestWith(["Notes/LocalOnly.md"]);
		// Vault holds BOTH — RemoteOnly was live-delivered by the gate-open race.
		mockApp.vault.getFiles.mockReturnValue([
			new TFile("Notes/RemoteOnly.md"),
			new TFile("Notes/LocalOnly.md"),
		]);
		// Unlike the sibling test, reconcile CAN resolve the race file here — so
		// without the snapshot fence, pushFile(RemoteOnly, true) would resurrect it.
		mockApp.vault.getFileByPath.mockImplementation((p: string) =>
			p === "Notes/RemoteOnly.md" ? new TFile("Notes/RemoteOnly.md") : null,
		);

		await engine.pushAll({
			replaceRemote: true,
			localSnapshot: new Set(["Notes/LocalOnly.md"]),
		});

		const pushedPaths = (mockApi.pushNote as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
		expect(pushedPaths).not.toContain("Notes/RemoteOnly.md");
	});
});

describe("FIX 1 (e2e test_47) — foreign-attributed delete of a confirmed-canonical note applies authoritatively", () => {
	// Root cause: a delete for a CONFIRMED + CANONICAL note used to defer to the
	// REST pull (`void this.pull()`), but pull/bootstrap never trashes a note
	// merely absent from the server — so a real remote delete of a confirmed note
	// was silently dropped and the file lived forever (test_47: A deletes
	// "OAuthWSDelete.md" via REST, B's live client kept it). A FOREIGN-attributed
	// delete (#970 device_id, not ours) is provably not our own stale echo, so it
	// is now applied authoritatively (trash + remotelyDeleted), CRDT-native, no
	// REST pull. The unattributed/self case still defers (see sync.test.ts
	// "delete for a live confirmed note defers to pull").
	function confirmedEngine(): { engine: SyncEngine; file: TFile } {
		const map = new NoteIdMap();
		map.set("OAuthWSDelete.md", "id-live");
		const engine = createEngine(map);
		engine.setDeviceId("device-B");
		(engine as unknown as { confirmNoteId(id: string): void }).confirmNoteId("id-live");
		// Reuse ONE instance: mock TFile stamps ctime=Date.now() at construction, so
		// two separate `new TFile(path)` are not deep-equal (flaky toHaveBeenCalledWith).
		const file = new TFile("OAuthWSDelete.md");
		mockApp.vault.getFileByPath.mockReturnValue(file);
		return { engine, file };
	}

	function remotelyDeleted(engine: SyncEngine): Map<string, unknown> {
		return (engine as unknown as { remotelyDeleted: Map<string, unknown> }).remotelyDeleted;
	}

	test("trashes the live note authoritatively and does NOT defer to the REST pull", async () => {
		const { engine, file } = confirmedEngine();
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "OAuthWSDelete.md",
			timestamp: 1709345678,
			device_id: "device-A",
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(file);
		expect(mockApi.getSyncChanges).not.toHaveBeenCalled(); // pull NOT taken
		expect(remotelyDeleted(engine).has("OAuthWSDelete.md")).toBe(true);
	});

	test("the applied delete is echo-suppressed and never re-pushed (test_86 wipe-echo invariant)", async () => {
		const { engine, file } = confirmedEngine();
		await engine.handleStreamEvent({
			event_type: "delete",
			path: "OAuthWSDelete.md",
			timestamp: 1709345678,
			device_id: "device-A",
		});
		(mockApi.deleteNote as jest.Mock).mockClear();

		// trashRemotelyDeleted fires B's own vault "delete" for the path;
		// handleDelete must see it as remote-applied and NOT re-push to the server.
		await engine.handleDelete(file);
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});

	test("preserves B's local UNPUSHED drift as a keep-both copy written BEFORE the trash", async () => {
		const { engine, file } = confirmedEngine();
		// B has un-synced edits: disk disagrees with the recorded baseline → drift.
		mockApp.vault.cachedRead.mockResolvedValue("B local unpushed edits");
		priv(engine).syncState.set("OAuthWSDelete.md", { hash: fnv1a("original synced body") });

		const order: string[] = [];
		mockApp.vault.create.mockImplementation((p: string) => {
			order.push(`create:${p}`);
			return Promise.resolve();
		});
		(mockApp.fileManager.trashFile as jest.Mock).mockImplementation(() => {
			order.push("trash");
			return Promise.resolve();
		});

		try {
			await engine.handleStreamEvent({
				event_type: "delete",
				path: "OAuthWSDelete.md",
				timestamp: 1709345678,
				device_id: "device-A",
			});

			// Keep-both copy written with the drift content...
			expect(mockApp.vault.create).toHaveBeenCalledWith(
				expect.stringMatching(/^OAuthWSDelete \(conflict .*\)\.md$/),
				"B local unpushed edits",
			);
			// ...and it lands BEFORE the trash (drift is durable before removeDoc).
			const createIdx = order.findIndex((o) => o.startsWith("create:"));
			const trashIdx = order.indexOf("trash");
			expect(createIdx).toBeGreaterThanOrEqual(0);
			expect(trashIdx).toBeGreaterThanOrEqual(0);
			expect(createIdx).toBeLessThan(trashIdx);
			expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(file);
		} finally {
			// Restore shared vault mocks (beforeEach only clears calls, not impls).
			mockApp.vault.create.mockReset().mockResolvedValue(undefined);
			mockApp.vault.cachedRead.mockReset().mockResolvedValue("# Test");
			(mockApp.fileManager.trashFile as jest.Mock).mockReset().mockResolvedValue(undefined);
		}
	});
});

describe("CRDT-authoritative delete rewire (REST detour removed)", () => {
	// A received delete is now applied directly on the socket receive path,
	// id-keyed — never routed to a REST pull (which skipped the tombstone and
	// re-pushed, resurrecting the note: e2e test_47). The delete→recreate case is
	// discriminated by comparing the delete's target id against the id currently
	// live at the path.
	function crdtDeps() {
		const crdt = {
			removeDoc: mock(async () => {}),
			applyLocalEdit: mock(async (_id: string, c: string) => c),
		};
		const enrollment = { enroll: mock(), reset: mock() };
		return { crdt, enrollment };
	}

	test("(a) received delete of a CRDT note trashes directly, no pull, room torn down", async () => {
		const map = new NoteIdMap();
		map.set("Notes/Live.md", "id-live");
		const engine = createEngine(map);
		const { crdt, enrollment } = crdtDeps();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);
		(engine as unknown as { confirmNoteId(id: string): void }).confirmNoteId("id-live");

		const file = new TFile("Notes/Live.md");
		mockApp.vault.getFileByPath.mockReturnValue(file);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/Live.md",
			timestamp: 1709345678,
			id: "id-live",
			device_id: "device-other",
		});

		expect(mockApp.fileManager.trashFile).toHaveBeenCalledWith(file);
		// No REST pull of any shape.
		expect(mockApi.getSyncChanges).not.toHaveBeenCalled();
		expect(mockApi.getManifest).not.toHaveBeenCalled();
		expect(mockApi.getNote).not.toHaveBeenCalled();
		// CRDT room for the deleted id torn down.
		expect(crdt.removeDoc).toHaveBeenCalledWith("id-live");
		expect(enrollment.reset).toHaveBeenCalledWith("id-live");
		expect(map.get("Notes/Live.md")).toBeNull();
	});

	test("(b) received delete whose target id != the path's current id (recreate) does NOT trash", async () => {
		// A delete→recreate minted a fresh id at the path. The delete carries the
		// DEAD id; the live note under the new id must survive.
		const map = new NoteIdMap();
		map.set("Notes/Recreated.md", "id-new");
		const engine = createEngine(map);
		const { crdt, enrollment } = crdtDeps();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);

		const file = new TFile("Notes/Recreated.md");
		mockApp.vault.getFileByPath.mockReturnValue(file);

		await engine.handleStreamEvent({
			event_type: "delete",
			path: "Notes/Recreated.md",
			timestamp: 1709345678,
			id: "id-old", // dead id
			device_id: "device-other",
		});

		expect(mockApp.fileManager.trashFile).not.toHaveBeenCalled();
		// The live note's room and mapping are untouched.
		expect(crdt.removeDoc).not.toHaveBeenCalledWith("id-new");
		expect(map.get("Notes/Recreated.md")).toBe("id-new");
	});

	test("(c) received delete with genuine local drift writes a keep-both copy BEFORE trashing", async () => {
		const map = new NoteIdMap();
		map.set("Notes/Drift.md", "id-drift");
		const engine = createEngine(map);
		(engine as unknown as { confirmNoteId(id: string): void }).confirmNoteId("id-drift");
		priv(engine).syncState.set("Notes/Drift.md", { hash: fnv1a("synced body") });

		const file = new TFile("Notes/Drift.md");
		mockApp.vault.getFileByPath.mockReturnValue(file);
		mockApp.vault.cachedRead.mockResolvedValue("unsynced local edits");

		const order: string[] = [];
		mockApp.vault.create.mockImplementation((p: string) => {
			order.push(`create:${p}`);
			return Promise.resolve();
		});
		(mockApp.fileManager.trashFile as jest.Mock).mockImplementation(() => {
			order.push("trash");
			return Promise.resolve();
		});

		try {
			await engine.handleStreamEvent({
				event_type: "delete",
				path: "Notes/Drift.md",
				timestamp: 1709345678,
				id: "id-drift",
				device_id: "device-other",
			});

			expect(mockApp.vault.create).toHaveBeenCalledWith(
				expect.stringMatching(/^Notes\/Drift \(conflict .*\)\.md$/),
				"unsynced local edits",
			);
			const createIdx = order.findIndex((o) => o.startsWith("create:"));
			const trashIdx = order.indexOf("trash");
			expect(createIdx).toBeGreaterThanOrEqual(0);
			expect(trashIdx).toBeGreaterThanOrEqual(0);
			expect(createIdx).toBeLessThan(trashIdx);
			expect(mockApi.getSyncChanges).not.toHaveBeenCalled();
		} finally {
			mockApp.vault.create.mockReset().mockResolvedValue(undefined);
			mockApp.vault.cachedRead.mockReset().mockResolvedValue("# Test");
			(mockApp.fileManager.trashFile as jest.Mock).mockReset().mockResolvedValue(undefined);
		}
	});

	test("(d) own local delete routes through crdtEnqueue, NOT api.deleteNote", async () => {
		const map = new NoteIdMap();
		map.set("Notes/Mine.md", "id-mine");
		const engine = createEngine(map);
		const { crdt, enrollment } = crdtDeps();
		engine.setCrdtManager(crdt as any);
		engine.setCrdtEnrollment(enrollment as any);
		const enqueued: unknown[] = [];
		engine.setCrdtEnqueue((op) => {
			enqueued.push(op);
		});

		const file = new TFile("Notes/Mine.md");
		await engine.handleDelete(file);

		expect(enqueued).toEqual([{ kind: "delete", docId: "id-mine", path: "Notes/Mine.md" }]);
		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});

	test("(d2) own local delete of a NEVER-synced note (no id) does nothing — no REST", async () => {
		const engine = createEngine(new NoteIdMap());
		engine.setCrdtEnqueue(() => {
			throw new Error("must not enqueue without an id");
		});

		const file = new TFile("Notes/NeverSynced.md");
		await engine.handleDelete(file);

		expect(mockApi.deleteNote).not.toHaveBeenCalled();
	});
});

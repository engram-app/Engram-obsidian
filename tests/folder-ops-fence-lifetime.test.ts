// Round-5 adversarial review of #689 @ 26f90b7.
// MEDIUM-4: the per-note fences a folder op sets must live as long as the op
// (not a 120 s timer) and survive a restart. LOW-6: the delete-pass check must
// not scan every fence per file. All three tests are red at 26f90b7.
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile, TFolder } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { HOLD_MAX_MS } from "../src/folder-ops";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

/** Proj/a.md synced; Proj renamed locally to Done; the server never answers. */
async function movedPending(api: Record<string, unknown> = {}) {
	const note = new TFile("Done/a.md");
	(note as any).stat = { mtime: 1, ctime: 1, size: 4 };
	const image = new TFile("Done/img.png");
	(image as any).stat = { mtime: 1, ctime: 1, size: 3 };
	const folder = new TFolder("Done", [note, image]);
	const byPath = new Map<string, unknown>([
		["Done", folder],
		["Done/a.md", note],
		["Done/img.png", image],
	]);
	const read = mock().mockResolvedValue("body");
	const app = {
		vault: {
			configDir: ".obsidian",
			cachedRead: read,
			read,
			readBinary: mock().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getFileByPath: (p: string) => byPath.get(p) ?? null,
			getName: () => "Vault",
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const e = new SyncEngine(
		app,
		api as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	e.setReady();
	const ids = new NoteIdMap();
	e.setNoteIdMap(ids);
	e.setCrdtPorts({ create: mock(), folderOp: async () => ({ kind: "retry" }) });
	ids.set("Proj/a.md", "id-a");
	(e as any).confirmNoteId("id-a");
	(e as any).syncState.set("Proj/a.md", { hash: 1, crdtHead: "h", seq: 3 });
	e.learnFolders([{ id: "f1", parent_id: null, name: "Proj" }]);
	await e.setFolderOpsEnabled(true);
	await e.handleRename(folder, "Proj");
	expect(e.folderOps.hasPending("f1")).toBe(true);
	expect(ids.pathForId("id-a")).toBe("Done/a.md");
	const clock = (e as any).time;
	const t0 = clock.now();
	return {
		e,
		advance: (ms: number) => {
			clock.now = () => t0 + ms;
		},
	};
}

test("MEDIUM-4: a peer's newer row at the OLD path is stale while the folder op is pending past 120 s", async () => {
	const { e, advance } = await movedPending();
	try {
		advance(10 * 60 * 1000); // a slow server: the op is still queued
		expect((e as any).isStalePathClaim("id-a", "Proj/a.md", 9)).toBe(true);
		expect((e as any).resolvePathClaim("id-a", "Proj/a.md", 9)).toBe("Done/a.md");
	} finally {
		e.destroy();
	}
});

test("MEDIUM-4: after a restart (no in-memory fence) the persisted op still fences the old path", async () => {
	const { e } = await movedPending();
	try {
		(e as any).pendingLocalMoves.clear(); // not persisted: a restart loses it
		expect((e as any).isStalePathClaim("id-a", "Proj/a.md", 9)).toBe(true);
		expect((e as any).isStalePathClaim("id-a", "Proj/a.md")).toBe(true);
	} finally {
		e.destroy();
	}
});

test("LOW-6: the delete-pass target check looks a fence up by id, never scans them", async () => {
	const { e } = await movedPending();
	e.folderOps.reset(); // isolate the per-note fence half
	const noScan = new Map((e as any).pendingLocalMoves);
	for (const k of ["values", "entries", "forEach", Symbol.iterator] as const) {
		(noScan as any)[k] = () => {
			throw new Error("scanned every fence");
		};
	}
	const real = (e as any).pendingLocalMoves;
	(e as any).pendingLocalMoves = noScan;
	try {
		expect((e as any).isPendingLocalMoveTarget("Done/a.md")).toBe(true);
		expect((e as any).isPendingLocalMoveTarget("Done/other.md")).toBe(false);
	} finally {
		// The engine's move-sweep timer is real and outlives this test: never
		// leave it a Map that throws (it fired inside another file on CI).
		(e as any).pendingLocalMoves = real;
		e.destroy();
	}
});

// Delta review of #689 @ a1029bdd, MEDIUM-2: with the socket down and REST up
// the op can neither be sent nor age, so a replay held under it waited forever.
test("MEDIUM-2: a replay held under an unsendable op is bounded: per-file fallback, then sent", async () => {
	const api = {
		pushAttachment: mock().mockResolvedValue({ hash: "h2" }),
		renameAttachment: mock().mockResolvedValue({}),
		deleteAttachment: mock().mockResolvedValue({}),
		deleteNote: mock().mockResolvedValue({}),
	};
	const { e, advance } = await movedPending(api);
	try {
		e.setCrdtPorts({ folderOp: async () => ({ kind: "held" }) }); // socket down
		await (e as any).enqueueChange({
			path: "Done/img.png",
			action: "upsert",
			kind: "attachment",
			mtime: 1,
			timestamp: Date.now(),
			vaultId: "v1",
		});
		await e.flushQueue();
		expect(api.pushAttachment).not.toHaveBeenCalled(); // held: the server has Proj/img.png
		expect(e.queue.size).toBe(1);
		advance(2 * 60 * 1000);
		await e.flushQueue();
		expect(api.pushAttachment).not.toHaveBeenCalled(); // still inside the bound
		advance(HOLD_MAX_MS + 3 * 60 * 1000);
		await e.flushQueue();
		for (let i = 0; i < 20 && e.folderOps.hasPending("f1"); i++) await Bun.sleep(1);
		expect(e.folderOps.hasPending("f1")).toBe(false); // abandoned to the per-file fallback
		await e.flushQueue();
		expect(api.pushAttachment).toHaveBeenCalled(); // the held upload went out
		expect(e.queue.all().some((q) => q.path === "Done/img.png" && q.action === "upsert")).toBe(
			false,
		);
	} finally {
		e.destroy();
	}
});

// tests/sim/folder-rename.test.ts
//
// Engram#2523 S4: one Obsidian folder rename is ONE `folder_op` on the wire,
// whatever order Obsidian fires its per-item rename events in (design risk
// R4: the order is not verified on mobile).
//
// Property, for each event order: no duplicate note (the server's live id set
// is unchanged), no resurrection (nothing left at the old paths, on the server
// or any disk), every replica converged, and the rename cost exactly one
// folder op with no per-note `crdt_create`, no attachment upload, delete or
// move.
//
// Convergence here is disk + note id per replica against the server, not the
// oracle's Y.Doc surface: a note B only DISCOVERED (disk from catch-up, doc not
// yet hydrated) reads as an empty doc to `assertConverged` before any rename,
// which is a sim limit unrelated to folder ops.
//
// The split order delivers most child events a tick after the folder's, so the
// same-tick batch cannot consume them: the Relay echo rule (a child whose note
// already lives at its new path is a no-op) is what keeps them off the wire.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup, type Topology } from "./scenarios";
import type { FolderRenameOrder } from "./vault-fs";

afterAll(() => Replica.restoreGlobals());

const NOTES: Record<string, string> = {
	"Proj/a.md": "alpha body",
	"Proj/sub/b.md": "beta body",
};
const IMAGE = "Proj/img.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** Wire calls that would mean the rename went per file. */
const PER_FILE = [
	"crdt_create",
	"POST /attachments",
	"POST /attachments/rename",
	"DELETE /attachments/*",
];

async function seeded(
	seed: number,
	serverOpts: { folderOps?: boolean; cascadeBroadcasts?: boolean },
): Promise<Topology> {
	const t = await boot(seed, ["A", "B"], serverOpts);
	const [a] = t.replicas;
	for (const [p, body] of Object.entries(NOTES)) await a.createNote(p, body);
	await a.createAttachment(IMAGE, PNG);
	await t.scheduler.drain();
	// A reconnect: the join's manifest teaches both devices the folder ids
	// (a folder first synced this session has none yet, and falls back).
	for (const r of t.replicas) {
		await r.goOffline();
		await r.goOnline();
	}
	await t.scheduler.drain();
	return t;
}

function snapshot(t: Topology): Map<string, number> {
	return new Map([...PER_FILE, "folder_op"].map((k): [string, number] => [k, t.server.count(k)]));
}

function delta(t: Topology, before: Map<string, number>, key: string): number {
	return t.server.count(key) - (before.get(key) ?? 0);
}

function read(r: Replica, rel: string): string | null {
	const p = path.join(r.vaultDir, rel);
	return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

function listFiles(dir: string, rel = ""): string[] {
	const out: string[] = [];
	for (const e of fs.readdirSync(rel ? path.join(dir, rel) : dir, { withFileTypes: true })) {
		const child = rel ? `${rel}/${e.name}` : e.name;
		if (e.isDirectory()) out.push(...listFiles(dir, child));
		else out.push(child);
	}
	return out;
}

function onDisk(r: Replica, rel: string): boolean {
	return fs.existsSync(path.join(r.vaultDir, rel));
}

async function renameAndCheck(t: Topology, order: FolderRenameOrder) {
	const [a, b] = t.replicas;
	const ids = t.server.liveNoteIds().sort();
	const before = snapshot(t);

	await a.renameFolder("Proj", "Done", order);
	await t.scheduler.drain();

	// Converged: disk and id on both replicas equal the server, no strays.
	for (const r of [a, b]) await r.goOnline();
	await t.scheduler.drain();
	const notes = t.server.state().notes;
	for (const r of [a, b]) {
		for (const [p, srv] of notes) {
			expect([r.id, p, read(r, p), r.noteIdMap.get(p)]).toEqual([
				r.id,
				p,
				srv.content,
				srv.id,
			]);
		}
		// The model serves no attachment bytes, so only A (the author) holds one.
		const files = listFiles(r.vaultDir).filter((f) => r === a || !f.endsWith(".png"));
		const expected = [...notes.keys(), ...(r === a ? ["Done/img.png"] : [])];
		expect(files.sort()).toEqual(expected.sort());
	}
	// No duplicate, no resurrection.
	expect(t.server.liveNoteIds().sort()).toEqual(ids);
	expect([...t.server.state().notes.keys()].sort()).toEqual(["Done/a.md", "Done/sub/b.md"]);
	expect(t.server.hasAttachmentAt("Done/img.png")).toBe(true);
	expect(t.server.hasAttachmentAt(IMAGE)).toBe(false);
	expect(onDisk(a, "Done/img.png")).toBe(true);
	for (const r of [a, b]) {
		expect(onDisk(r, "Proj/a.md")).toBe(false);
		expect(onDisk(r, "Proj/sub/b.md")).toBe(false);
		expect(onDisk(r, IMAGE)).toBe(false);
	}
	return before;
}

describe("Engram#2523 S4: a folder rename is one folder op", () => {
	const orders: FolderRenameOrder[] = ["folder-first", "children-first", "split"];
	for (const [i, order] of orders.entries()) {
		test(`${order}: 1 folder_op, nothing per file, converged`, async () => {
			const t = await seeded(2523 + i, { folderOps: true });
			try {
				const before = await renameAndCheck(t, order);
				expect(delta(t, before, "folder_op")).toBe(1);
				for (const k of PER_FILE) expect([k, delta(t, before, k)]).toEqual([k, 0]);
			} finally {
				cleanup(t);
			}
		});
	}

	test("S5 server (no per-note cascade broadcasts): the peer follows folder_changed", async () => {
		const t = await seeded(2530, { folderOps: true, cascadeBroadcasts: false });
		try {
			const before = await renameAndCheck(t, "folder-first");
			expect(delta(t, before, "folder_op")).toBe(1);
		} finally {
			cleanup(t);
		}
	});

	test("server without folder ops: per-file fallback, attachments moved not re-uploaded", async () => {
		const t = await seeded(2531, { folderOps: false });
		try {
			const before = await renameAndCheck(t, "folder-first");
			expect(delta(t, before, "folder_op")).toBe(0);
			expect(delta(t, before, "crdt_create")).toBe(Object.keys(NOTES).length);
			expect(delta(t, before, "POST /attachments/rename")).toBe(1);
			expect(delta(t, before, "POST /attachments")).toBe(0);
		} finally {
			cleanup(t);
		}
	});

	test("refused (the name was taken while offline): per-file fallback converges", async () => {
		const t = await seeded(2532, { folderOps: true });
		try {
			const [a, b] = t.replicas;
			const ids = t.server.liveNoteIds().sort();
			await a.goOffline();
			await b.createNote("Done/x.md", "x body");
			await t.scheduler.drain();
			const before = snapshot(t);

			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			await a.goOnline();
			await t.scheduler.drain();

			// One op was tried and refused; the notes then moved one by one.
			expect(delta(t, before, "folder_op")).toBe(1);
			expect(delta(t, before, "crdt_create")).toBe(Object.keys(NOTES).length);
			const xId = t.server.state().notes.get("Done/x.md")?.id;
			expect(t.server.liveNoteIds().sort()).toEqual([...ids, xId].sort());
			expect([...t.server.state().notes.keys()].sort()).toEqual([
				"Done/a.md",
				"Done/sub/b.md",
				"Done/x.md",
			]);
			for (const r of [a, b]) {
				for (const [p, srv] of t.server.state().notes) {
					expect([r.id, p, read(r, p), r.noteIdMap.get(p)]).toEqual([
						r.id,
						p,
						srv.content,
						srv.id,
					]);
				}
				expect(onDisk(r, "Proj/a.md")).toBe(false);
			}
		} finally {
			cleanup(t);
		}
	});

	test("offline peer: folder moves apply BEFORE the manifest delete pass (nothing trashed)", async () => {
		const t = await seeded(2533, { folderOps: true, cascadeBroadcasts: false });
		try {
			const [a, b] = t.replicas;
			await b.goOffline();
			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			// B's catch-up runs with the socket still down: the manifest's folders
			// and the delete pass, nothing from the live feed.
			const sync = b.fullSync();
			await t.scheduler.drain();
			await sync;
			expect(b.trashed()).toEqual([]);
			expect(read(b, "Done/a.md")).toBe(NOTES["Proj/a.md"]);
			expect(read(b, "Done/sub/b.md")).toBe(NOTES["Proj/sub/b.md"]);
			expect(onDisk(b, "Proj/a.md")).toBe(false);
		} finally {
			cleanup(t);
		}
	});

	test("our own folder_changed echo is dropped by device_id", async () => {
		const t = await seeded(2534, { folderOps: true, cascadeBroadcasts: false });
		try {
			const [a] = t.replicas;
			const seen: string[] = [];
			const engine = a.engine as unknown as {
				applyFolderChange: (c: { id: string; device_id?: string | null }) => Promise<void>;
			};
			const real = engine.applyFolderChange.bind(a.engine);
			engine.applyFolderChange = async (c) => {
				// The ack's own follow-up (no device_id) is not an inbound event.
				if (c.device_id !== undefined) seen.push(c.id);
				await real(c);
			};
			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			expect(t.server.count("folder_op")).toBeGreaterThan(0);
			expect(seen).toEqual([]);
		} finally {
			cleanup(t);
		}
	});

	test("cascading server: the peer absorbs the per-note events after the one folder event", async () => {
		const t = await seeded(2535, { folderOps: true, cascadeBroadcasts: true });
		try {
			const [a, b] = t.replicas;
			const renames = b.renamed().length;
			const writes = b.writeJournal().length;
			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			// One folder rename on B's disk: no per-file move, no rewrite, no trash.
			expect(b.renamed().slice(renames)).toEqual(["Proj -> Done"]);
			expect(b.writeJournal().length - writes).toBe(0);
			expect(b.trashed()).toEqual([]);
			expect(read(b, "Done/a.md")).toBe(NOTES["Proj/a.md"]);
		} finally {
			cleanup(t);
		}
	});

	test("a manifest read while our op is pending holds nothing (it is not another writer)", async () => {
		const t = await seeded(2536, { folderOps: true });
		try {
			const [a] = t.replicas;
			(a.engine as any).setCrdtPorts({ folderOp: async () => ({ kind: "retry" }) });
			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			const r = (a.engine as any).reconcileNoteIdMapFromManifest();
			await t.scheduler.drain();
			await r;
			const fo = (a.engine as any).folderOps;
			expect(fo.held.size).toBe(0);
			expect(fo.all()).toHaveLength(1);
			expect(onDisk(a, "Done/a.md")).toBe(true);
		} finally {
			cleanup(t);
		}
	});
});

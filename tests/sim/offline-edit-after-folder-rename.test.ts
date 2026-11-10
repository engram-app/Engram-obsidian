// A queued offline edit + a server-side folder rename + a reconnect must leave
// ONE note at the NEW path with the edit, and no folder at the old path.
// The two reconnect triggers race: the REST health check (`goOnline`) used to
// flush the queue at once, before the crdt rejoin had pulled the rename.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup, type Topology } from "./scenarios";

afterAll(() => Replica.restoreGlobals());
const onDisk = (r: Replica, rel: string) => fs.existsSync(path.join(r.vaultDir, rel));
/** Past MAX_CRDT_NOTE_BYTES (4 MiB): such a note can only sync over REST. */
const BIG = `OFFLINE EDIT${"x".repeat(4 * 1024 * 1024 + 10)}`;
/** drain() cannot see real file IO (a 4 MiB read), so yield to the event loop
 *  between drains until the virtual world is quiet. */
async function settle(t: { scheduler: { drain(): Promise<unknown> } }): Promise<void> {
	for (let i = 0; i < 16; i++) {
		await Bun.sleep(25);
		await t.scheduler.drain();
	}
}
const read = (r: Replica, rel: string) => fs.readFileSync(path.join(r.vaultDir, rel), "utf8");

type Order = "health-first" | "pull-first";
/** rest = a queue entry with no crdt marker (old entries, the "mint refused"
 *  content-free entry): replayed over REST. crdt = the control, an id-bound
 *  markdown edit that rides the socket. */
type Kind = "rest" | "crdt";

async function offlineSetup(seed: number) {
	const t = await boot(seed, ["A", "B"], { folderOps: true, strictRestPath: true });
	const [a, b] = t.replicas;
	const e = a.engine as any;
	await a.createNote("Proj/n.md", "v1 body");
	await t.scheduler.drain();
	for (const r of t.replicas) {
		await r.goOffline();
		await r.goOnline();
	}
	await t.scheduler.drain();
	await a.goOffline();
	e.goOffline();
	e.stopHealthCheck(); // the test, not a timer, decides who wins the race
	return { t, a, b, e };
}

/** What a REST push that failed offline leaves behind: the edit on disk and a
 *  plain (no crdt marker) content-free queue entry. */
async function queueRest(a: Replica, e: any, content: string): Promise<void> {
	const real = e.handleModify;
	e.handleModify = () => {};
	await a.app.vault.modify(a.app.vault.getFileByPath("Proj/n.md")!, content);
	e.handleModify = real;
	const f = a.app.vault.getFileByPath("Proj/n.md")!;
	await e.enqueueChange({
		path: "Proj/n.md",
		action: "upsert",
		kind: "note",
		mtime: f.stat.mtime / 1000,
		timestamp: Date.now(),
		vaultId: e.settings.vaultId,
	});
}

const serverContent = (t: Topology) => [...t.server.state().notes.values()][0]?.content;

/** A has `Proj/n.md` synced; A goes offline and edits it; B renames Proj to
 *  Done on the server; A reconnects with the two triggers in `order`. */
async function run(kind: Kind, order: Order, seed: number, who: "server" | "me" = "server") {
	const { t, a, b, e } = await offlineSetup(seed);
	const edited = kind === "rest" ? BIG : "OFFLINE EDIT";
	if (who === "server") {
		await b.renameFolder("Proj", "Done", "folder-first");
		await t.scheduler.drain();
	}
	if (kind === "crdt") {
		await a.editNote("Proj/n.md", edited);
		await t.scheduler.drain();
	} else {
		await queueRest(a, e, edited);
	}
	if (who === "me") {
		// Our own folder rename, made offline: a folder op still pending.
		await a.renameFolder("Proj", "Done", "folder-first");
		await t.scheduler.drain();
	}
	if (order === "health-first") {
		// The health check wins: its flush starts before the rejoin pulls.
		e.goOnline();
		await a.goOnline();
	} else {
		await a.goOnline(); // rejoin: pull, then flush
		await settle(t);
		e.goOnline();
	}
	await settle(t);
	await settle(t);
	return { t, a, edited, e };
}

describe("offline edit + folder rename + reconnect", () => {
	let seed = 5100;
	for (const who of ["server", "me"] as const)
		for (const kind of ["rest", "crdt"] as Kind[])
			for (const order of ["health-first", "pull-first"] as Order[])
				test(`${who} renames, ${kind} replay, ${order}: one note at the new path, edit kept, no old folder`, async () => {
					const { t, a, edited } = await run(kind, order, seed++, who);
					try {
						expect([...t.server.state().notes.keys()]).toEqual(["Done/n.md"]);
						expect(t.server.folderPaths()).not.toContain("Proj");
						expect(onDisk(a, "Proj/n.md")).toBe(false);
						expect(read(a, "Done/n.md")).toBe(edited);
						expect([...t.server.state().notes.values()][0].content).toBe(edited);
					} finally {
						cleanup(t);
					}
				}, 30_000);
});

describe("pending folder op + queued REST replay", () => {
	test("our own rename is unanswered while the replay flushes: no fork, no lost edit once it lands", async () => {
		const t = await boot(5200, ["A", "B"], { folderOps: true, strictRestPath: true });
		try {
			const [a] = t.replicas;
			const e = a.engine as any;
			await a.createNote("Proj/n.md", "v1 body");
			await t.scheduler.drain();
			for (const r of t.replicas) {
				await r.goOffline();
				await r.goOnline();
			}
			await t.scheduler.drain();
			await a.goOffline();
			e.goOffline();
			e.stopHealthCheck();
			const real = e.handleModify;
			e.handleModify = () => {};
			await a.app.vault.modify(a.app.vault.getFileByPath("Proj/n.md")!, BIG);
			e.handleModify = real;
			const f = a.app.vault.getFileByPath("Proj/n.md")!;
			await e.enqueueChange({
				path: "Proj/n.md",
				action: "upsert",
				kind: "note",
				mtime: f.stat.mtime / 1000,
				timestamp: Date.now(),
				vaultId: e.settings.vaultId,
			});
			// The server answers our folder op "retry": it stays pending/held.
			const ch = (a as any).channel;
			const realOp = ch.folderOp.bind(ch);
			e.setCrdtPorts({ folderOp: async () => ({ kind: "retry" }) });
			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			e.goOnline();
			await a.goOnline();
			await settle(t);
			// The op finally lands.
			e.setCrdtPorts({ folderOp: realOp });
			const reconnect = e.folderOps.onReconnect();
			await settle(t);
			await reconnect;
			await settle(t);
			const keys = [...t.server.state().notes.keys()];
			expect(keys).toEqual(["Done/n.md"]);
			expect(t.server.folderPaths()).not.toContain("Proj");
			expect(read(a, "Done/n.md")).toBe(BIG);
			expect([...t.server.state().notes.values()][0].content).toBe(BIG);
		} finally {
			cleanup(t);
		}
	}, 30_000);
});

describe("the flush gate always clears (#692 delta review)", () => {
	test("T1 no catch-up port (REST-only): nothing is held", async () => {
		const { t, a, e } = await offlineSetup(5300);
		try {
			await queueRest(a, e, BIG);
			e.setCrdtPorts({ catchupSince: null });
			e.goOnline();
			await settle(t);
			expect(e.queue.size).toBe(0);
			expect(serverContent(t)).toBe(BIG);
		} finally {
			cleanup(t);
		}
	}, 30_000);

	test("T2 catch-up fails every time: released after the miss cap, edit sent", async () => {
		const { t, a, e } = await offlineSetup(5301);
		try {
			await queueRest(a, e, BIG);
			e.setCrdtPorts({
				catchupSince: async () => {
					throw new Error("boom");
				},
			});
			e.goOnline();
			await settle(t);
			await settle(t);
			expect(e.queue.size).toBe(0);
			expect(e.catchupPending).toBe(false);
			expect(serverContent(t)).toBe(BIG);
		} finally {
			cleanup(t);
		}
	}, 30_000);

	test("T4 a catch-up already running at goOffline does not wedge the queue", async () => {
		const t = await boot(5302, ["A", "B"], { folderOps: true, strictRestPath: true });
		try {
			const [a] = t.replicas;
			const e = a.engine as any;
			await a.createNote("Proj/n.md", "v1 body");
			await t.scheduler.drain();
			const running = e.catchupViaSeqReplay(); // started before the drop
			e.goOffline();
			e.stopHealthCheck();
			await queueRest(a, e, BIG);
			e.goOnline();
			await settle(t);
			await running;
			await settle(t);
			expect(e.queue.size).toBe(0);
			expect(e.catchupPending).toBe(false);
			expect(serverContent(t)).toBe(BIG);
		} finally {
			cleanup(t);
		}
	}, 30_000);

	test("flapping online/offline with the catch-up never completing still drains", async () => {
		const { t, a, e } = await offlineSetup(5303);
		try {
			await queueRest(a, e, BIG);
			for (let i = 0; i < 4; i++) {
				e.goOnline();
				await Promise.resolve();
				e.goOffline();
				e.stopHealthCheck();
			}
			e.goOnline();
			await settle(t);
			await settle(t);
			expect(e.queue.size).toBe(0);
			expect(serverContent(t)).toBe(BIG);
		} finally {
			cleanup(t);
		}
	}, 30_000);

	test("T5 reload: a persisted REST replay is gated again, the rename is not undone", async () => {
		const { t, a, b, e } = await offlineSetup(5304);
		try {
			await b.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			await queueRest(a, e, BIG);
			// A reload: a fresh engine has no gate, then main.ts loads the queue.
			e.catchupPending = false;
			e.gateRestReplaysAtStartup();
			e.goOnline();
			await a.goOnline();
			await settle(t);
			await settle(t);
			expect([...t.server.state().notes.keys()]).toEqual(["Done/n.md"]);
			expect(serverContent(t)).toBe(BIG);
			expect(t.server.folderPaths()).not.toContain("Proj");
		} finally {
			cleanup(t);
		}
	}, 30_000);
});

describe("offline DELETE + server-side folder rename", () => {
	test("the moved note is not forked and the old folder stays gone; both sides agree", async () => {
		const { t, a, b, e } = await offlineSetup(5400);
		try {
			const f = a.app.vault.getFileByPath("Proj/n.md")!;
			const real = e.handleDelete;
			e.handleDelete = async () => {};
			await a.app.fileManager.trashFile(f);
			e.handleDelete = real;
			await e.enqueueChange({
				path: "Proj/n.md",
				action: "delete",
				kind: "note",
				evidenced: true,
				mtime: 1,
				timestamp: Date.now(),
				vaultId: e.settings.vaultId,
			});
			await b.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			e.goOnline();
			await a.goOnline();
			await settle(t);
			await settle(t);
			const keys = [...t.server.state().notes.keys()];
			expect(keys.filter((k) => k.startsWith("Proj/"))).toEqual([]);
			expect(t.server.folderPaths()).not.toContain("Proj");
			expect(onDisk(a, "Proj/n.md")).toBe(false);
			// Pinned outcome: the delete went to the old path (404, already moved), so
			// the note survives at the new path and comes back locally. No fork, no
			// resurrected folder; the user's delete is not honoured (follow-up: delete
			// entries should follow the note id too).
			expect(keys).toEqual(["Done/n.md"]);
			expect(onDisk(a, "Done/n.md")).toBe(true);
		} finally {
			cleanup(t);
		}
	}, 30_000);
});

// A queued offline edit + a server-side folder rename + a reconnect must leave
// ONE note at the NEW path with the edit, and no folder at the old path.
// The two reconnect triggers race: the REST health check (`goOnline`) used to
// flush the queue at once, before the crdt rejoin had pulled the rename.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());
const onDisk = (r: Replica, rel: string) => fs.existsSync(path.join(r.vaultDir, rel));
/** Past MAX_CRDT_NOTE_BYTES (4 MiB): such a note can only sync over REST. */
const BIG = `OFFLINE EDIT${"x".repeat(4 * 1024 * 1024 + 10)}`;
/** drain() cannot see real file IO (a 4 MiB read), so yield to the event loop
 *  between drains until the virtual world is quiet. */
async function settle(t: { scheduler: { drain(): Promise<unknown> } }): Promise<void> {
	for (let i = 0; i < 6; i++) {
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

/** A has `Proj/n.md` synced; A goes offline and edits it; B renames Proj to
 *  Done on the server; A reconnects with the two triggers in `order`. */
async function run(kind: Kind, order: Order, seed: number, who: "server" | "me" = "server") {
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
	const edited = kind === "rest" ? BIG : "OFFLINE EDIT";
	if (who === "server") {
		await b.renameFolder("Proj", "Done", "folder-first");
		await t.scheduler.drain();
	}
	if (kind === "crdt") {
		await a.editNote("Proj/n.md", edited);
		await t.scheduler.drain();
	} else {
		// What a REST push that failed offline leaves behind: the edit on disk
		// and a plain (no crdt marker) content-free queue entry.
		const real = e.handleModify;
		e.handleModify = () => {};
		await a.app.vault.modify(a.app.vault.getFileByPath("Proj/n.md")!, edited);
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
	if (who === "me") {
		// Our own folder rename, made offline: a folder op still pending.
		await a.renameFolder("Proj", "Done", "folder-first");
		await t.scheduler.drain();
	}
	if (order === "health-first") {
		e.goOnline(); // the health check wins: flushes before any pull
		await settle(t);
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
			await settle(t);
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

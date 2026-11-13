// A queued offline edit + a folder rename + a reconnect must leave ONE note at
// the NEW path with the edit, and no folder at the old path (#692).
// The two reconnect triggers race: the REST health check (`goOnline`) used to
// flush the queue at once, before the crdt rejoin had pulled the rename.
//
// No timers drive any of this: the held replay is released by events (catch-up
// complete, socket join, health-check success), so `drain()` always quiesces.
// `until` only waits for real file IO (the 4 MiB bodies), which drain cannot
// see, by polling the CONDITION the test asserts.
import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Replica } from "./replica";
import { boot, cleanup, type Topology } from "./scenarios";

afterAll(() => Replica.restoreGlobals());
const onDisk = (r: Replica, rel: string) => fs.existsSync(path.join(r.vaultDir, rel));
/** Past MAX_CRDT_NOTE_BYTES (4 MiB): such a note can only sync over REST. */
const BIG = `OFFLINE EDIT${"x".repeat(4 * 1024 * 1024 + 10)}`;
const read = (r: Replica, rel: string) => fs.readFileSync(path.join(r.vaultDir, rel), "utf8");
const serverContent = (t: Topology) => [...t.server.state().notes.values()][0]?.content;

/** One flush trigger that cannot complete a catch-up: a health-check success
 *  with the socket down, then the link drops again. */
async function missTrigger(t: Topology, e: any): Promise<void> {
	e.goOnline();
	await until(t, () => e.flushInFlight === null, "trigger settled");
	e.goOffline();
	e.stopHealthCheck();
}

async function until(t: Topology, cond: () => boolean, label: string): Promise<void> {
	for (let i = 0; i < 400; i++) {
		await t.scheduler.drain();
		if (cond()) return;
		await Bun.sleep(5);
	}
	throw new Error(`never reached: ${label}`);
}

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

/** The converged end state: one note at the new path, edit on server and disk. */
const landed = (t: Topology, a: Replica, e: any, edited: string) => () =>
	e.queue.size === 0 &&
	serverContent(t) === edited &&
	onDisk(a, "Done/n.md") &&
	!onDisk(a, "Proj/n.md") &&
	read(a, "Done/n.md") === edited;

function expectOneNoteAtNewPath(t: Topology) {
	expect([...t.server.state().notes.keys()]).toEqual(["Done/n.md"]);
	expect(t.server.folderPaths()).not.toContain("Proj");
}

/** A has `Proj/n.md` synced; A goes offline and edits it; B renames Proj to
 *  Done on the server; A reconnects with the two triggers in `order`. */
async function run(kind: Kind, order: Order, seed: number, who: "server" | "me") {
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
		await t.scheduler.drain();
		e.goOnline();
	}
	await until(t, landed(t, a, e, edited), `${who}/${kind}/${order} landed`);
	return { t, a, edited, e };
}

describe("offline edit + folder rename + reconnect", () => {
	let seed = 5100;
	for (const who of ["server", "me"] as const)
		for (const kind of ["rest", "crdt"] as Kind[])
			for (const order of ["health-first", "pull-first"] as Order[])
				test(`${who} renames, ${kind} replay, ${order}: one note at the new path, edit kept, no old folder`, async () => {
					const { t } = await run(kind, order, seed++, who);
					try {
						expectOneNoteAtNewPath(t);
					} finally {
						cleanup(t);
					}
				}, 30_000);
});

describe("pending folder op + queued REST replay", () => {
	test("our own rename is unanswered while the replay flushes: no fork, no lost edit once it lands", async () => {
		const { t, a, e } = await offlineSetup(5200);
		try {
			await queueRest(a, e, BIG);
			// The server answers our folder op "retry": it stays pending/held.
			const realOp = (a as any).channel.folderOp.bind((a as any).channel);
			e.setCrdtPorts({ folderOp: async () => ({ kind: "retry" }) });
			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			e.goOnline();
			await a.goOnline();
			await t.scheduler.drain();
			// The op finally lands.
			e.setCrdtPorts({ folderOp: realOp });
			const reconnect = e.folderOps.onReconnect();
			await t.scheduler.drain();
			await reconnect;
			await until(t, landed(t, a, e, BIG), "folder op landed with the edit");
			expectOneNoteAtNewPath(t);
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
			await until(t, () => e.queue.size === 0 && serverContent(t) === BIG, "T1 sent");
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
			// Three flush triggers (health-check successes), each a miss.
			for (let i = 0; i < 3; i++) await missTrigger(t, e);
			e.goOnline();
			await until(
				t,
				() => e.queue.size === 0 && serverContent(t) === BIG,
				"T2 released and sent",
			);
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
			await until(t, () => e.queue.size === 0 && serverContent(t) === BIG, "T4 sent");
			await running;
			expect(e.catchupPending).toBe(false);
		} finally {
			cleanup(t);
		}
	}, 30_000);

	test("flapping online/offline with the catch-up never completing still drains", async () => {
		const { t, a, e } = await offlineSetup(5303);
		try {
			await queueRest(a, e, BIG);
			for (let i = 0; i < 4; i++) await missTrigger(t, e);
			e.goOnline();
			await until(t, () => e.queue.size === 0 && serverContent(t) === BIG, "flap sent");
		} finally {
			cleanup(t);
		}
	}, 30_000);

	test("T5 startup: a persisted REST replay is gated by loadQueue, a startup flush cannot undo the rename", async () => {
		const { t, a, b, e } = await offlineSetup(5304);
		try {
			await b.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			await queueRest(a, e, BIG);
			// A restart: a fresh engine has no gate and an empty queue; main.ts then
			// loads the persisted queue, and the startup sync flushes it while the
			// socket is still down.
			const saved = e.queue.persistable();
			await e.queue.clear();
			e.catchupPending = false;
			e.offline = false;
			// The catch-up port is set by the channel join, which has not happened.
			const port = e.crdtCatchupSince;
			e.setCrdtPorts({ catchupSince: null });
			e.loadQueue(saved);
			const startupFlush = e.flushQueue();
			await t.scheduler.drain();
			await startupFlush;
			expect(e.queue.size).toBe(1); // held, not parked, not sent to the old path
			expect(e.issues.all()).toEqual([]);
			expect(serverContent(t)).toBe("v1 body");
			e.setCrdtPorts({ catchupSince: port });
			await a.goOnline(); // the socket joins: pull, then flush
			await until(t, landed(t, a, e, BIG), "T5 landed");
			expectOneNoteAtNewPath(t);
		} finally {
			cleanup(t);
		}
	}, 30_000);
});

describe("startup join that never arrives (delta review 3)", () => {
	test("a REST-only session with a persisted replay is held for at most the miss cap", async () => {
		const { t, a, e } = await offlineSetup(5500);
		try {
			await queueRest(a, e, BIG);
			const saved = e.queue.persistable();
			await e.queue.clear();
			e.offline = false;
			e.catchupPending = false;
			e.setCrdtPorts({ catchupSince: null });
			e.loadQueue(saved);
			for (let i = 0; i < 2; i++) {
				await e.flushQueue();
				expect(e.queue.size).toBe(1); // held
			}
			void e.flushQueue(); // third miss releases it
			await until(t, () => e.queue.size === 0 && serverContent(t) === BIG, "REST-only sent");
		} finally {
			cleanup(t);
		}
	}, 30_000);
});

describe("an entry with no note id is never silently dropped (delta review 4)", () => {
	/** The server moved the folder; A holds a REST replay for the old path whose
	 *  entry carries no noteId (as saved by an older plugin). */
	async function idlessEntry(seed: number, forget: boolean) {
		const { t, a, b, e } = await offlineSetup(seed);
		await b.renameFolder("Proj", "Done", "folder-first");
		await t.scheduler.drain();
		await queueRest(a, e, BIG);
		const saved = e.queue.persistable().map((x: any) => ({ ...x, noteId: undefined }));
		await e.queue.clear();
		// The id map names the old path unless the test says it forgot it.
		if (forget) e.noteIdMap.release("Proj/n.md");
		return { t, a, e, saved };
	}

	test("old-format entry (no noteId): the id is resolved at load, the edit follows the move", async () => {
		const { t, a, e, saved } = await idlessEntry(7100, false);
		try {
			e.loadQueue(saved);
			expect(e.queue.all()[0].noteId).toBeTruthy();
			e.offline = false;
			await a.goOnline();
			await until(t, landed(t, a, e, BIG), "old-format entry landed");
			expectOneNoteAtNewPath(t);
		} finally {
			cleanup(t);
		}
	}, 30_000);

	test("retryFailedNow entry carries the id and follows the move", async () => {
		const { t, a, b, e } = await offlineSetup(7101);
		try {
			await b.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			const f = a.app.vault.getFileByPath("Proj/n.md")!;
			const real = e.handleModify;
			e.handleModify = () => {};
			await a.app.vault.modify(f, BIG);
			e.handleModify = real;
			const now = Date.now();
			e.issues.record({
				path: "Proj/n.md",
				kind: "note",
				category: "network",
				message: "offline",
				firstFailedAt: now,
				lastFailedAt: now,
				attempts: 1,
			});
			void e.retryFailedNow();
			await t.scheduler.drain();
			expect(e.queue.all()[0]?.noteId).toBeTruthy();
			e.goOnline();
			await a.goOnline();
			await until(t, landed(t, a, e, BIG), "retryFailedNow entry landed");
			expectOneNoteAtNewPath(t);
		} finally {
			cleanup(t);
		}
	}, 30_000);

	test("unresolvable entry (no id anywhere): kept queued and surfaced, never dropped", async () => {
		const { t, a, e, saved } = await idlessEntry(7102, true);
		try {
			e.loadQueue(saved);
			expect(e.queue.all()[0].noteId).toBeUndefined();
			e.offline = false;
			await a.goOnline();
			await until(t, () => e.issues.all().length === 1, "issue surfaced");
			expect(e.queue.size).toBe(1);
			expect(serverContent(t)).toBe("v1 body");
		} finally {
			cleanup(t);
		}
	}, 30_000);
});

describe("a user delete cancels the queued id-less upsert (delta review 5)", () => {
	const entry = (p: string, e: any) => ({
		path: p,
		action: "upsert" as const,
		kind: "note" as const,
		mtime: 1,
		timestamp: Date.now(),
		vaultId: e.settings.vaultId,
	});

	async function flushes(t: Topology, e: any, n: number) {
		for (let i = 0; i < n; i++) {
			void e.flushQueue();
			await until(t, () => e.flushInFlight === null, "flush settled");
		}
	}

	test("never-synced note: queue and issues end at 0, on every flush", async () => {
		const { t, a, e } = await offlineSetup(7300);
		try {
			const real = e.handleModify;
			e.handleModify = () => {};
			await a.createNote("Tmp/x.md", "x"); // never synced, no id
			e.handleModify = real;
			e.noteIdMap.release("Tmp/x.md");
			e.loadQueue([entry("Tmp/x.md", e)]);
			e.offline = false;
			await a.deleteNote("Tmp/x.md");
			await t.scheduler.drain();
			await flushes(t, e, 4);
			expect(e.queue.size).toBe(0);
			expect(e.issues.all()).toEqual([]);
		} finally {
			cleanup(t);
		}
	}, 30_000);

	test("synced note: the delete wins, queue and issues end at 0, server empty", async () => {
		const { t, a, e } = await offlineSetup(7301);
		try {
			e.loadQueue([entry("Proj/n.md", e)]);
			e.offline = false;
			await a.deleteNote("Proj/n.md");
			await t.scheduler.drain();
			await flushes(t, e, 4);
			expect(e.queue.size).toBe(0);
			expect(e.issues.all()).toEqual([]);
			// The delete itself rides the crdt op queue; the socket returns.
			await a.goOnline();
			await until(t, () => t.server.state().notes.size === 0, "server note deleted");
			expect(e.queue.size).toBe(0);
			expect(e.issues.all()).toEqual([]);
		} finally {
			cleanup(t);
		}
	}, 30_000);
});

describe("a session whose socket never joins (delta review 4)", () => {
	test("the poll supplies the triggers: held for two ticks, sent on the third", async () => {
		const { t, a, e } = await offlineSetup(7200);
		try {
			await queueRest(a, e, BIG);
			const saved = e.queue.persistable();
			await e.queue.clear();
			e.offline = false;
			e.catchupPending = false;
			e.setCrdtPorts({ catchupSince: null }); // the join never arrives
			e.loadQueue(saved);
			for (let i = 0; i < 2; i++) {
				await e.pollFlush();
				expect(e.queue.size).toBe(1);
			}
			void e.pollFlush();
			await until(t, () => e.queue.size === 0 && serverContent(t) === BIG, "third tick sent");
		} finally {
			cleanup(t);
		}
	}, 30_000);
});

describe("cap release with no pull (delta review 2)", () => {
	/** REST is up, the socket stays down: three flush triggers pass, the server
	 *  renamed the folder. */
	async function capReleased(seed: number) {
		const { t, a, b, e } = await offlineSetup(seed);
		await b.renameFolder("Proj", "Done", "folder-first");
		await t.scheduler.drain();
		await queueRest(a, e, BIG);
		for (let i = 0; i < 3; i++) await missTrigger(t, e);
		return { t, a, e };
	}

	test("R2-1 the refused old-path replay is re-held, still queued, and lands once the pull arrives", async () => {
		const { t, a, e } = await capReleased(7001);
		try {
			e.goOnline(); // the trigger that releases the gate: 409 on the old path
			await until(t, () => e.flushInFlight === null, "released flush settled");
			// Never silently dropped: not on the server yet, so it must still be queued.
			expect(serverContent(t)).toBe("v1 body");
			expect(e.queue.size).toBe(1);
			expect(e.issues.all()).toEqual([]);
			await a.goOnline(); // socket back: complete catch-up clears the hold
			await until(t, landed(t, a, e, BIG), "R2-1 landed");
			expectOneNoteAtNewPath(t);
		} finally {
			cleanup(t);
		}
	}, 60_000);

	test("R2-2 after STALE_HOLD_ISSUE_AT refusals the user is told, and the edit stays queued", async () => {
		const { t, e } = await capReleased(7002);
		try {
			for (let i = 0; i < 6; i++) {
				e.goOffline();
				e.stopHealthCheck();
				e.goOnline();
				await until(t, () => e.flushInFlight === null, "refusal settled");
			}
			expect(e.queue.size).toBe(1);
			expect(e.issues.all().length).toBe(1);
			expect(serverContent(t)).toBe("v1 body");
		} finally {
			cleanup(t);
		}
	}, 60_000);

	test("R3 the only trigger is the periodic poll: its completed catch-up releases the held edit", async () => {
		const { t, a, e } = await capReleased(7004);
		try {
			e.goOnline(); // releases the gate: 409, re-held
			await until(t, () => e.flushInFlight === null, "re-held");
			expect(e.queue.size).toBe(1);
			// The socket returns but its own join flush is muted: only the poll runs.
			const realFlush = e.flushQueue.bind(e);
			e.flushQueue = () => Promise.resolve(0);
			await a.goOnline();
			await t.scheduler.drain();
			e.flushQueue = realFlush;
			expect(e.queue.size).toBe(1);
			e.catchupPending = true; // still owed: the join's catch-up ran with the flush muted
			void e.catchupViaSeqReplay(); // the FALLBACK_POLL_MS tick (main.ts), nothing else
			await until(t, landed(t, a, e, BIG), "poll released the edit");
		} finally {
			cleanup(t);
		}
	}, 60_000);

	test("a crdt marker holding a REAL Y.Doc edit at the new path does not swallow the oversized REST replay", async () => {
		const { t, a, e } = await offlineSetup(7003);
		try {
			// Our own folder rename, offline; then a real (small) edit of the moved
			// note: it lives in the Y.Doc and leaves a crdt marker at Done/n.md.
			await queueRest(a, e, "REST STUB");
			await a.renameFolder("Proj", "Done", "folder-first");
			await t.scheduler.drain();
			await a.editNote("Done/n.md", "DOC EDIT");
			await t.scheduler.drain();
			expect(e.queue.get("Done/n.md", e.settings.vaultId)?.crdt).toBe(true);
			// Then the file grows past the crdt cap: only REST can carry it.
			const real = e.handleModify;
			e.handleModify = () => {};
			await a.app.vault.modify(a.app.vault.getFileByPath("Done/n.md")!, BIG);
			e.handleModify = real;
			e.goOnline();
			await a.goOnline();
			await until(t, landed(t, a, e, BIG), "marker + replay landed");
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
			await until(t, () => e.queue.size === 0 && onDisk(a, "Done/n.md"), "delete settled");
			const keys = [...t.server.state().notes.keys()];
			// Pinned outcome (follow-up filed separately): the delete went to the old
			// path (404, already moved), so the note survives at the new path and
			// comes back locally. No fork, no resurrected folder.
			expect(keys).toEqual(["Done/n.md"]);
			expect(t.server.folderPaths()).not.toContain("Proj");
			expect(onDisk(a, "Proj/n.md")).toBe(false);
		} finally {
			cleanup(t);
		}
	}, 30_000);
});

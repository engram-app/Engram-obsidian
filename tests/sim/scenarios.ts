// tests/sim/scenarios.ts
//
// Named, seeded, DETERMINISTIC scripts — no randomness beyond the scheduler's
// seeded PRNG (and each scenario drains round-robin, so ordering is fixed).
// Each scenario boots a real-SyncEngine topology (Task 5) against the model
// server (Task 4), drives a specific fault interleaving via the scheduler's
// hold/release + the model's dropNext, and returns the booted topology so the
// oracle (Task 6, assertConverged/findWipes) can judge convergence.
//
// These back the DIFFERENTIAL REGRESSION GATE (Task 7 / trap T1): a scenario is
// only trustworthy if it REPRODUCES the known bug on pre-fix engine code and
// PASSES on the fix. See regressions.test.ts for the recorded SHAs + the
// per-scenario current-base verdict.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SimClock } from "./clock";
import { ModelServer } from "./model-server";
import { Replica } from "./replica";
import { Scheduler } from "./scheduler";

export interface Topology {
	clock: SimClock;
	scheduler: Scheduler;
	server: ModelServer;
	replicas: Replica[];
	rootDir: string;
}

/** Boot N replicas sharing one model server + scheduler, joins settled. */
async function boot(
	seed: number,
	ids: string[],
	serverOpts: { genesisEmptyDoc?: boolean } = {},
): Promise<Topology> {
	const clock = new SimClock();
	const scheduler = new Scheduler(seed, clock);
	const server = new ModelServer({ scheduler, ...serverOpts });
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-regr-"));
	const replicas: Replica[] = [];
	for (const id of ids) {
		replicas.push(await Replica.boot({ id, server, scheduler, clock, rootDir }));
	}
	await scheduler.drain();
	return { clock, scheduler, server, replicas, rootDir };
}

export function cleanup(t: Topology): void {
	fs.rmSync(t.rootDir, { recursive: true, force: true });
}

function disk(r: Replica, notePath: string): string | null {
	const p = path.join(r.vaultDir, notePath);
	return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

// ---------------------------------------------------------------------------
// Scenario 1 — #288 genesis-wipe.
//
// genesisEmptyDoc:true. A creates a note (content on disk); B enrolls the empty
// genesis it discovers via the crdt_doc_ready feed WHILE A's content push is
// still queued — the scheduler HOLDS A's create-reply lane (`net:A`), and the
// create-reply is what create-acks A's note and releases the canSendLive gate
// on the body update. So during the hold the server room is an unseeded empty
// genesis; B enrolls it; then A's content is released.
//
// Correct behaviour (#289 guard): no file goes non-empty -> empty without an
// explicit delete (findWipes empty) and both replicas converge to A's content.
// Pre-#289: the empty genesis is flushed over the creator's just-written file.
// ---------------------------------------------------------------------------

export interface GenesisWipeResult {
	topology: Topology;
	notePath: string;
	authored: string;
	/** Disk snapshot the instant B has enrolled the empty genesis but A's push
	 *  is still held — the window the bug fires in. */
	midDiskA: string | null;
	midDiskB: string | null;
}

export async function genesisWipe(seed = 288): Promise<GenesisWipeResult> {
	const t = await boot(seed, ["A", "B"], { genesisEmptyDoc: true });
	const [a, b] = t.replicas;
	const notePath = "genesis.md";
	const authored = "# Genesis\n\nauthored by A before the room was seeded\n";

	// Hold A's inbound lane so the create-reply (which release-gates A's body
	// push via canSendLive) cannot land: A's content stays queued.
	t.scheduler.hold("net:A");
	await a.createNote(notePath, authored);
	// Drain everything EXCEPT net:A: crdt_create reaches the server (empty
	// genesis), crdt_doc_ready fans out to B, B enrolls STEP1 and receives the
	// empty room state. A's body push is stuck behind the held create-ack.
	await t.scheduler.drain();

	const midDiskA = disk(a, notePath);
	const midDiskB = disk(b, notePath);

	// Release A's push; converge.
	t.scheduler.release("net:A");
	await t.scheduler.drain();

	return { topology: t, notePath, authored, midDiskA, midDiskB };
}

// ---------------------------------------------------------------------------
// Scenario 2 — #282 equal-seq fence skip.
//
// Two replicas share a note. B MISSES a live delivery (dropNext on B) carrying
// A's edit, then makes its own local edit (its high-water seq advances off its
// own push). On reconnect, catch-up delivers the row whose seq EQUALS B's
// high-water but whose content carries the server-side merge B never saw.
//
// Correct behaviour (#296 hash-aware fence): the equal-seq row carries a
// content_hash differing from B's stored serverHash, so it is NOT stale — B
// applies it and converges. Pre-#296 (plain `<=`): the equal-seq row is fenced
// as "history" regardless of content and B is stuck missing A's edit.
// ---------------------------------------------------------------------------

export interface EqualSeqResult {
	topology: Topology;
	notePath: string;
	fromA: string;
}

export async function equalSeqFence(seed = 282): Promise<EqualSeqResult> {
	const t = await boot(seed, ["A", "B"], { genesisEmptyDoc: true });
	const [a, b] = t.replicas;
	const notePath = "fence.md";
	await a.createNote(notePath, "base\n");
	await t.scheduler.drain(); // both converge to "base"

	// B misses the NEXT server->B delivery: A's edit fan-out is dropped.
	t.server.dropNext("B");
	const fromA = "base\nedited by A (B will miss the live delivery)\n";
	await a.editNote(notePath, fromA);
	await t.scheduler.drain(); // A + server hold A's edit; B never saw it

	// B makes its own local edit -> B pushes -> server merges -> B's own push
	// echo advances B's recorded high-water seq to the merged row's seq.
	await b.editNote(notePath, "base\nedited by A (B will miss the live delivery)\nand by B\n");
	await t.scheduler.drain();

	// Reconnect B: the crdt: rejoin fires catch-up (catchupViaSeqReplay), which
	// delivers the equal-seq row carrying the server merge.
	await b.goOffline();
	await t.scheduler.drain();
	await b.goOnline();
	await t.scheduler.drain();

	return { topology: t, notePath, fromA };
}

// ---------------------------------------------------------------------------
// Scenario 3 — test_85 shape: missed delivery + local push, NO deletion.
//
// Ported 1:1 from the e2e test_missed_delivery_then_local_push (test_85): A and
// B share a note; B misses A's live edit; B then pushes a local edit; on
// reconnect both must converge to a merge of BOTH edits (no revert, no loss),
// and nothing is deleted. Distinct from Scenario 2: the assertion is on
// three-way convergence of two concurrent edits, the classic test_85 oracle.
// ---------------------------------------------------------------------------

export interface Test85Result {
	topology: Topology;
	notePath: string;
}

export async function test85MissedDeliveryLocalPush(seed = 85): Promise<Test85Result> {
	const t = await boot(seed, ["A", "B"], { genesisEmptyDoc: true });
	const [a, b] = t.replicas;
	const notePath = "test85.md";
	await a.createNote(notePath, "line1\n");
	await t.scheduler.drain();

	// A appends a line; B misses the live fan-out.
	t.server.dropNext("B");
	await a.editNote(notePath, "line1\nfrom-A\n");
	await t.scheduler.drain();

	// B appends its OWN line locally (concurrent, no deletion) and pushes.
	await b.editNote(notePath, "line1\nfrom-B\n");
	await t.scheduler.drain();

	// Reconnect drives catch-up; both should converge to the merged doc.
	await b.goOffline();
	await t.scheduler.drain();
	await b.goOnline();
	await t.scheduler.drain();

	return { topology: t, notePath };
}

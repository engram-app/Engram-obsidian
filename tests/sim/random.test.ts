// tests/sim/random.test.ts
//
// SEEDED RANDOM CONVERGENCE SUITE — the gating counterpart to the scripted
// differential gate (regressions.test.ts). Five real SyncEngine replicas share
// one ModelServer + Scheduler and drive a long stream of RANDOM, INTERLEAVED
// concurrent edits (kinds/targets/timings all from the scheduler's single seeded
// PRNG). After the faults cease, the STRICT oracle (assertConverged: disk +
// Y.Doc text + noteIdMap + findWipes, #288) demands every replica + the server
// agree on every note.
//
// WHY THIS IS GREEN NOW (it was a de-tested tool — random-harness.ts — before):
// the P2 tier-fidelity gap #1 is closed. This tier now MODELS editor
// binding/enrollment (Replica.openNote → isBound true → real STEP1 enrollment →
// history-FULL Y.Doc; edits stream via the live-editor path; deferUntilSeeded is
// honored). With notes history-FULL, sustained concurrent editing converges
// through the real 3-way CRDT merge instead of the history-less keep-both
// conflict-copy storm that forced the old harness to stay a runnable tool. See
// tests/sim/replica.ts's header + docs/context/crdt-convergence-sim-fidelity-gaps.md.
//
// ============================================================================
// IN SCOPE (what this suite gates): sustained CONCURRENT ONLINE editing of a
// working set of established notes, under drop faults + full-sync churn, with
// notes opened (bound + enrolled) across replicas. This is the case gap #1 was
// blocking: real 3-way merge convergence.
//
// TWO PHASES (why): a note only propagates a live edit once its server row is
// confirmed (crdtHead set → canSendLive true → the manager sends the update
// instead of HOLDING it; sync.ts flushHeldEditsOnCreateAck / canSendLive). Phase
// 1 creates the working set and drains so every replica holds each note
// history-FULL with a crdtHead. Phase 2 then edits concurrently — every edit can
// reach the server, so no lineage gap forms.
//
// OUT OF SCOPE (documented tier gaps — deliberately NOT exercised here; NOT
// oracle-loosening, these ops are simply not driven):
//   * OFFLINE editing / offline-online churn. Kept out to keep this suite
//     focused on sustained ONLINE concurrency — NOT because it diverges. A
//     live-bound note's offline edit is held in the Y.Doc (its REST fallback is
//     short-circuited by the isLiveBound gate, sync.ts:1982) and recovers on
//     reconnect via the MUTUAL rejoin handshake: the server answers the client's
//     re-enroll STEP1 with its OWN STEP1 (the real y_ex backend's
//     encode_sync_step1_response_v1 — verified on the live crdt_channel as
//     [step2, step1]), and the client replies STEP2 with the held struct. Proven
//     deterministically by `#299 live-bound offline edit recovers on reconnect`
//     in regressions.test.ts. (A prior model-server was PULL-ONLY and falsely
//     "lost" these edits — the sim infidelity that mis-filed #299; fixed
//     2026-07-23 by making the model solicit client ops on rejoin.)
//   * CREATE-during-concurrent-edit. Editing a note still racing its
//     genesis/enrollment (crdtHead unset → canSendLive HOLDS the edit until the
//     create acks). Phase 1 establishes notes first to keep this out. Distinct
//     from offline: the hold here is the genesis race, not the rejoin handshake
//     (which is faithful — see above).
//   * DELETE + RENAME. The model omits note_changed (documented divergence #2):
//     a delete/rename only reaches other replicas via a later reconnect
//     catch-up, stranding stale old-path files at quiescence. Unchanged from the
//     harness. Belongs to the P2 real-backend tier.
//
// SEED HANDLING mirrors the old harness: each iteration draws a FRESH seed from
// real entropy (the ONE sanctioned nondeterminism — WHICH seed to explore); the
// run is then deterministic under it. SIM_SEED forces a single replay. The seed
// is printed for every iteration with a copy-paste replay command, and
// assertConverged embeds it in any divergence report. CI runs SIM_ITERATIONS=10.
// ============================================================================
import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SimClock } from "./clock";
import { ModelServer } from "./model-server";
import { assertConverged } from "./oracle";
import { Replica } from "./replica";
import { Scheduler } from "./scheduler";

// Restore the process-global boot() patches so later files in a full `bun test`
// run don't inherit the frozen virtual clock / no-op setInterval.
afterAll(() => Replica.restoreGlobals());

const REPLICA_IDS = ["A", "B", "C", "D", "E"];
const OPS = process.env.SIM_OPS ? Number(process.env.SIM_OPS) : 120;
const NNOTES = 8;
const NOTE_PATHS = Array.from({ length: NNOTES }, (_, i) => `n${i}.md`);

type Rand = () => number;
function pick<T>(rand: Rand, arr: T[]): T {
	return arr[Math.floor(rand() * arr.length)];
}

/** Draw a fresh seed from real entropy BEFORE any Replica.boot installs the
 *  SimClock (Date.now/Math.random are still the real globals here) — the
 *  sanctioned "pick which seed to explore" step, not in-sim nondeterminism. */
function pickSeed(): number {
	return (Date.now() ^ (Math.random() * 2 ** 31)) >>> 0;
}

function readNote(r: Replica, notePath: string): string {
	const p = path.join(r.vaultDir, notePath);
	return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

/** One full seeded run. Boots 5 replicas, establishes the working set, drives a
 *  random concurrent-edit stream, quiesces, and asserts strict convergence.
 *  assertConverged throws (with the seed + replay command) on any divergence. */
async function runSeed(seed: number): Promise<void> {
	const clock = new SimClock();
	const scheduler = new Scheduler(seed, clock);
	const server = new ModelServer({ scheduler });
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-random-"));
	const replicas: Replica[] = [];
	for (const id of REPLICA_IDS) {
		replicas.push(await Replica.boot({ id, server, scheduler, clock, rootDir }));
	}
	await scheduler.drain();

	try {
		// Phase 1 — establish the working set: A creates every note; drain so all
		// replicas materialize them history-FULL; then every replica opens them
		// (enroll → STEP1 → crdtHead) and drains so canSendLive is true everywhere.
		for (const p of NOTE_PATHS) await replicas[0].createNote(p, `# ${p}\nbase\n`);
		await scheduler.drain();
		for (const r of replicas) for (const p of NOTE_PATHS) await r.openNote(p);
		await scheduler.drain();

		// Phase 2 — random concurrent edits + faults, interleaved by the seeded PRNG.
		for (let i = 0; i < OPS; i++) {
			const r = pick(scheduler.rand, replicas);
			const roll = scheduler.rand();
			if (roll < 0.8) {
				// EDIT an established, open (history-full) note — concurrent 3-way merge.
				const p = pick(scheduler.rand, NOTE_PATHS);
				await r.editNote(p, `${readNote(r, p)}e${i}@${r.id}\n`);
			} else if (roll < 0.9) {
				// DROP the next server→client frame to r (transient loss; catch-up heals).
				server.dropNext(r.id);
			} else {
				// FULL SYNC (REST round-trip) — fired, driven to completion by later steps.
				void r.fullSync().catch(() => {});
			}
			// Interleave: advance the scheduler a seed-derived number of steps so
			// deliveries partially overlap subsequent ops (the concurrency under test).
			const steps = Math.floor(scheduler.rand() * 6);
			for (let s = 0; s < steps; s++) if (!(await scheduler.step())) break;
		}

		// Faults cease: clear residual drops, re-open every note on every replica so
		// any idle catch-up-delivered note hydrates its Y.Doc (idle notes are
		// disk-only until opened — sync.ts:5184), then assert quiescent convergence.
		server.clearDrops();
		for (const r of replicas) {
			await r.goOnline();
			for (const p of NOTE_PATHS) await r.openNote(p);
		}
		await scheduler.drain();
		await assertConverged(replicas, server, scheduler);
	} finally {
		fs.rmSync(rootDir, { recursive: true, force: true });
	}
}

test("seeded random: 5 replicas × concurrent online editing converge (strict oracle)", async () => {
	const iterations = process.env.SIM_SEED
		? 1
		: process.env.SIM_ITERATIONS
			? Number(process.env.SIM_ITERATIONS)
			: 6;
	// A gating test whose job includes leaving a replayable seed breadcrumb on
	// stdout BEFORE each run (so a hang/OOM still names the seed). Aliasing
	// console.log keeps that intent explicit — same pattern as random-harness.ts.
	// biome-ignore lint/suspicious/noConsole: replayable seed breadcrumb is the point
	const log = console.log;
	for (let k = 0; k < iterations; k++) {
		const seed = process.env.SIM_SEED ? Number(process.env.SIM_SEED) >>> 0 : pickSeed();
		log(
			`[sim/random] seed=${seed} (${OPS} ops × ${REPLICA_IDS.length} replicas)  ` +
				`replay: SIM_SEED=${seed} bun test tests/sim/random.test.ts`,
		);
		await runSeed(seed);
	}
}, 600_000);

// Deterministic editor-lifecycle coverage: open → concurrent edit → close (flush
// + free the doc) → reopen → edit again, all converging. Guards the openNote /
// closeNote flush+hydration seams the random suite leans on, in a scripted,
// drain-between-ops (non-racy) shape so any regression in them is a hard failure.
test("editor lifecycle: open, concurrent edit, close, reopen, edit — converges", async () => {
	const clock = new SimClock();
	const scheduler = new Scheduler(42, clock);
	const server = new ModelServer({ scheduler });
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-lifecycle-"));
	const a = await Replica.boot({ id: "A", server, scheduler, clock, rootDir });
	const b = await Replica.boot({ id: "B", server, scheduler, clock, rootDir });
	await scheduler.drain();
	const p = "lifecycle.md";
	try {
		await a.createNote(p, "# lifecycle\nbase\n");
		await scheduler.drain();

		// Both open (enroll → history-full), then edit CONCURRENTLY (no drain between).
		await a.openNote(p);
		await b.openNote(p);
		await scheduler.drain();
		await a.editNote(p, `${readNote(a, p)}from-A\n`);
		await b.editNote(p, `${readNote(b, p)}from-B\n`);
		await scheduler.drain();
		await assertConverged([a, b], server, scheduler);

		// A closes the note (last-release flush to disk + closeDoc), then reopens and
		// edits again — the reopen must re-hydrate and the new edit must converge.
		await a.closeNote(p);
		await scheduler.drain();
		await a.openNote(p);
		await scheduler.drain();
		await a.editNote(p, `${readNote(a, p)}from-A-again\n`);
		await scheduler.drain();
		await assertConverged([a, b], server, scheduler);

		// Sanity: the note carries all three edits, not a wiped/forked lineage.
		const srv = server.state().notes.get(p);
		expect(srv?.content).toContain("from-A");
		expect(srv?.content).toContain("from-B");
		expect(srv?.content).toContain("from-A-again");
	} finally {
		fs.rmSync(rootDir, { recursive: true, force: true });
	}
});

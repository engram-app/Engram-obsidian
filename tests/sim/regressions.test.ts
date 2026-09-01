// tests/sim/regressions.test.ts
//
// DIFFERENTIAL REGRESSION GATE (P1 Task 7 / trap T1). Each test below asserts
// CORRECT convergence for a scenario that DETERMINISTICALLY reproduces a known
// real-backend bug on the PRE-FIX engine and FLIPS to converged under the real
// fix. A gate that only ever passes proves nothing; these were validated by the
// source-overlay method (git checkout <fix-oid> -- <file>) documented per test.
//
// FIDELITY PREREQUISITE (P1 Task 7b): the model server had to be made faithful
// to ONE real-backend behavior before #282 could be discriminated at all —
// update_v1/4's self-inclusive `note_yjs_update` fan-out (the originator gets
// its own push echoed back, carrying the post-push `seq`). See the FIDELITY
// comment on model-server.ts `fanoutUpdate` (cites crdt_persistence.ex:159-200
// + sync.ts applyLiveOpWithSeq:1631-1648). Without that echo the pusher's
// per-path high-water never advanced from its own push, so the equal-seq `<=`
// fence never decided the outcome and the bug was invisible to the model.
//
// GREEN PRECONDITION (honest-green): this suite is green ONLY because src/sync.ts
// carries the MERGED #296 content-hash-aware equal-seq fence (an equal-seq row is
// stale only when its content_hash matches stored.serverHash; a differing hash
// falls through and converges). Overlay the PRE-fix plain `<=` (pre-#296 main,
// `git checkout 5cd7adf -- src/sync.ts`) and #282/test_85 go RED (bug reproduced)
// — that overlay IS the differential proof, not a regression. Do not "fix" a red
// here by loosening the oracle; restore the fence.
//
// NOT COVERED — #288 genesis wipe (model-tier fidelity limit, Task 7b third
// gap): a PLAIN-content genesis is a truly-EMPTY server doc in reality too
// (crdt_create -> genesis_crdt_note makes content=""; bind/3 seed_from_content
// on "" and normalize_doc on an empty/no-frontmatter body both produce ZERO
// ops — crdt_bridge.ex:283-288, notes.ex:910). So no "structure-carrying,
// empty-body remote update" ever fans out, and #289's manager-listener guard
// (src/crdt/manager.ts) is UNREACHABLE via a plain genesis — in the model AND
// in reality. The model's genesis scenario diverges via a DIFFERENT mechanism
// (canSendLive-gated content-loss + the REST /changes discovery path,
// findWipes empty), which #289 does not touch. Reproducing #288's guarded path
// needs a frontmatter-bearing (structure-only, empty-body) note and a bind race
// — a headless/server-tier scenario (P2), not this client-only model tier.
import { afterAll, expect, test } from "bun:test";
import { assertConverged, findWipes } from "./oracle";
import { Replica } from "./replica";
import {
	cleanup,
	equalSeqFence,
	genesisWipe,
	offlineBoundEditRecovers,
	offlineEditSwitchAwayRecovers,
	renameThenDeleteFast,
	test85MissedDeliveryLocalPush,
} from "./scenarios";

// The scenarios boot replicas (via scenarios.ts), which install the process-global
// SimClock/WebSocket/indexedDB patches. Restore them so later files in a full
// `bun test` run don't inherit the frozen virtual clock / no-op setInterval.
afterAll(() => Replica.restoreGlobals());

// #282 — equal-seq fence skip.
//
// DIFFERENTIAL PROOF (source overlay):
//   base  `git checkout 5cd7adf -- src/sync.ts` (pre-#296 plain `change.seq <=
//         stored.seq`): B is STUCK missing A's edit — B disk ends "...and by
//         B\n", the server-merged second A-edit fenced out as "history".
//         DIVERGES.
//   fix   `git checkout fd1095a -- src/sync.ts` (#296 hash-aware: an equal-seq
//         row whose content_hash differs from stored.serverHash is NOT stale):
//         B applies the equal-seq catch-up row and CONVERGES to the server merge.
// src/sync.ts carries the merged #296 fence, so this asserts the converged side.
test("#282 equal-seq fence: B's own-push echo must not fence the sole carrier", async () => {
	const r = await equalSeqFence();
	try {
		await assertConverged(r.topology.replicas, r.topology.server, r.topology.scheduler);
	} finally {
		cleanup(r.topology);
	}
	expect(true).toBe(true);
});

// test_85 — missed delivery + local push, no deletion. Shares #282's transport,
// so on the PRE-fix plain `<=` base B is ALSO stuck (missing "from-A"); flips to
// the three-way merge under the #296 hash-aware fence. A second, independently-
// scripted witness for the same fence class (concurrent edits survive, no revert).
test("test_85 missed-delivery + local push: both edits survive, no revert", async () => {
	const r = await test85MissedDeliveryLocalPush();
	try {
		await assertConverged(r.topology.replicas, r.topology.server, r.topology.scheduler);
	} finally {
		cleanup(r.topology);
	}
	expect(true).toBe(true);
});

// #299 — live-bound offline edit recovers via the mutual rejoin handshake.
//
// DIFFERENTIAL PROOF (model-server fidelity):
//   base  a PULL-ONLY model-server (readSyncMessage returns only STEP2) never
//         solicits B's held struct on rejoin — B's offline edit is stranded in
//         its Y.Doc, A never sees it, DIVERGES. This was the sim infidelity that
//         mis-filed #299 as a real backend bug.
//   fix   the model-server now answers a client STEP1 with its OWN STEP1 too
//         (matching the live y_ex backend's [step2, step1] — encode_sync_step1_
//         response_v1); B replies STEP2 with the held struct and CONVERGES.
// The real backend was never pull-only; only the test double was.
test("#299 live-bound offline edit recovers on reconnect (mutual handshake)", async () => {
	const r = await offlineBoundEditRecovers();
	try {
		await assertConverged(r.topology.replicas, r.topology.server, r.topology.scheduler);
	} finally {
		cleanup(r.topology);
	}
	expect(true).toBe(true);
});

// #299b — offline edit + SWITCH AWAY recovers on reconnect (switch-away class).
//
// Prod "moving between files, only some edits make it": an edit typed while the
// socket is down, to a note then CLOSED before reconnect, is stranded because
// reEnrollOpenCrdtNotes only re-enrolls still-open notes.
//
// Assert on SERVER CONTENT (not assertConverged): if reconnect instead reverted
// A's edit, all replicas would land on "base" and a convergence check would
// FALSELY pass. The server-content assertion fails whether the edit is dropped
// OR reverted. Green ONLY with wiring.reEnrollUnsent() on the rejoin path.
test("#299b offline edit + switch-away reaches the server on reconnect", async () => {
	const r = await offlineEditSwitchAwayRecovers();
	try {
		const srv = r.topology.server.state().notes.get(r.notePath);
		expect(srv?.content ?? "").toContain("offline edit by A");
	} finally {
		cleanup(r.topology);
	}
});

// #288 genesis-wipe — DOCUMENTED-BOUNDARY PIN (P1 Task 7b: exercise the
// otherwise-dead genesisWipe scenario + scheduler hold/release fault primitive).
//
// This scenario (scheduler.hold("net:A") to freeze A's create-ack while B
// enrolls the empty genesis, then release) is NOT a converge-on-fix gate — it
// pins the MODEL TIER'S DISCRIMINATION LIMIT for #288 (regressions header +
// scenarios.ts): a PLAIN empty genesis is a truly-empty server doc in reality
// too, so #289's manager-listener guard is UNREACHABLE via plain genesis. The
// documented, honest outcome in this model tier is therefore:
//   - findWipes() == []  — the write-journal #288 detector does NOT fire (A's
//     disk keeps its content; no non-empty->empty WRITE ever happens), so the
//     model does NOT FALSELY flag a wipe; AND
//   - assertConverged THROWS — the scenario still DIVERGES, but via a DIFFERENT
//     mechanism (canSendLive-gated content loss: A's authored body never seeds
//     the server room, so server + B end empty while A's disk holds content).
// Pinning BOTH sides keeps hold/release + genesisWipe live scaffolding and
// nails the "the model can't discriminate #288 via plain genesis" boundary so a
// future change that alters it trips this test. Full #288 repro is a P2 server-
// tier concern (frontmatter-bearing empty-body note + bind race).
test("#288 genesis-wipe: model tier does NOT flag a wipe, but does not converge (boundary)", async () => {
	const r = await genesisWipe();
	try {
		// No FALSE wipe flag — the reliable write-journal detector stays clean.
		expect(findWipes(r.topology.replicas)).toEqual([]);
		// But the scenario diverges (content-loss, not a detected wipe): the model
		// tier cannot discriminate #288 via a plain genesis. Pin that it throws.
		await expect(
			assertConverged(r.topology.replicas, r.topology.server, r.topology.scheduler),
		).rejects.toThrow(/diverged from the server/);
	} finally {
		cleanup(r.topology);
	}
});

// #489 — a rename dropped the note's sync evidence, so the delete that followed
// it inside the push window was REFUSED and the note never died server-side.
//
// DIFFERENTIAL PROOF (source overlay):
//   base  `git checkout <pre-fix> -- src/sync.ts` (handleRename calling
//         `dropPath(oldPath, { dropBase: false })` instead of moving the row):
//         `Delete push REFUSED (no sync evidence)`, the deleted note stays live
//         on the server, and the next note at the freed path is ADOPTED onto it
//         (`crdt_create ADOPT: remapped ... -> <dead id>`) — both assertions red.
//   fix   evidence moves with the note (renamePath), the delete lands, and the
//         second note gets its own id.
test("#489 rename-then-delete: the delete lands and the next note is not adopted", async () => {
	const r = await renameThenDeleteFast();
	try {
		const live = r.topology.server.state().notes;
		// The deleted note is gone server-side — under BOTH the path it was
		// renamed to and the one it was created at.
		expect(live.has(r.renamedPath)).toBe(false);
		expect([...live.values()].map((n) => n.id)).not.toContain(r.firstId);
		// The note created at the freed path is its own note, not the dead one
		// wearing a new path (the `:adopted` branch discards the client body).
		expect(r.firstId).not.toBeNull();
		expect(r.secondId).not.toBeNull();
		expect(r.secondId).not.toBe(r.firstId);
	} finally {
		cleanup(r.topology);
	}
});

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
import { cleanup, equalSeqFence, genesisWipe, test85MissedDeliveryLocalPush } from "./scenarios";

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

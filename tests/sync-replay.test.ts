import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { deserializeTimeline, SyncRecorder, serializeTimeline } from "../src/sync-recorder";
import { replayTimeline } from "./helpers/replay";

/**
 * Poll until `cond` holds.
 *
 * NOT a bigger sleep. The STEP1/STEP2 handshake spans several async turns (two
 * IndexeddbPersistence.whenSynced resolutions plus the relay's queueMicrotask
 * hops), so a fixed sleep is racy under parallel load — the sibling
 * provider-registry.test.ts and wiring.test.ts carry the same helper and the
 * same warning. Tearing a registry down mid-handshake abandons the in-flight
 * entry() await, and its NoteDestroyedError surfaces as a test failure with a
 * stack pointing at destroyAll rather than at the real cause.
 */
async function waitFor(cond: () => boolean, label: string): Promise<void> {
	for (let i = 0; i < 200; i++) {
		if (cond()) return;
		await new Promise<void>((r) => setTimeout(r, 5));
	}
	throw new Error(`waitFor timed out: ${label}`);
}

/** Record a real two-device exchange, then hand back its timeline. This is the
 *  loop the whole feature exists for: a live session produces a timeline, and
 *  the timeline reproduces the session. */
async function recordExchange(dbPrefix: string) {
	const recorder = new SyncRecorder({ enabled: () => true });
	let A: ProviderRegistry;
	let B: ProviderRegistry;
	const flushedB: Record<string, string> = {};

	A = new ProviderRegistry({
		dbPrefix: `${dbPrefix}-A`,
		recorder,
		send: (id, frame) => {
			queueMicrotask(() => void B.receive(id, frame));
			return true;
		},
		onFlushToDisk: () => true,
	});
	B = new ProviderRegistry({
		dbPrefix: `${dbPrefix}-B`,
		send: (id, frame) => {
			queueMicrotask(() => void A.receive(id, frame));
			return true;
		},
		onFlushToDisk: (id, content) => {
			flushedB[id] = content;
		},
	});

	A.setConnected(true);
	B.setConnected(true);
	await A.applyLocalEdit("note-1", "hello world");
	A.enroll("note-1");
	B.enroll("note-1");
	// Wait for the exchange to actually COMPLETE, not for a fixed duration:
	// B receiving the content is the observable end of the handshake.
	await waitFor(() => flushedB["note-1"] === "hello world", "B flushed A's content");

	const timeline = recorder.timeline();
	await A.destroyAll();
	await B.destroyAll();
	return { timeline, flushedB };
}

describe("recorder → replay round trip", () => {
	test("a live exchange produces a timeline that survives serialization", async () => {
		const { timeline } = await recordExchange("rt1");

		expect(timeline.length).toBeGreaterThan(0);
		expect(deserializeTimeline(serializeTimeline(timeline))).toEqual(timeline);
	});

	test("the timeline records the seams in causal order", async () => {
		const { timeline } = await recordExchange("rt2");
		const kinds = timeline.map((e) => e.kind);

		expect(kinds).toContain("connection");
		expect(kinds).toContain("localEdit");
		expect(kinds).toContain("enroll");
		// Ordering is by construction, so the recorded seq must be strictly
		// increasing — the property the log `time` field could never give us.
		const seqs = timeline.map((e) => e.seq);
		expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
	});

	test("replaying the recorded inputs converges a fresh registry to the same text", async () => {
		const { timeline } = await recordExchange("rt3");
		const hash = timeline.find((e) => e.kind === "localEdit")?.data.hash as string;
		// The replayable INPUTS are the inbound frames, the connection landmarks,
		// the room lifecycle, and the local edits. `send` and `flush` entries are
		// OUTPUTS — assertions about what the system produced, not things to do.
		const inputs = timeline.filter(
			(e) => e.kind !== "send" && e.kind !== "flush" && e.kind !== "remoteUpdate",
		);

		const result = await replayTimeline(inputs, {
			dbPrefix: "rt3-replay",
			contentByHash: { [hash]: "hello world" },
		});

		expect(result.divergences).toEqual([]);
		expect(result.finalText["note-1"]).toBe("hello world");
	});

	test("inbound frames alone cannot reconstruct locally-originated content", async () => {
		// A real constraint worth pinning, not a bug. Content this device authored
		// enters through localEdit and only ever leaves as an outbound frame, so a
		// timeline filtered to `receive` carries no trace of it. A caller that
		// forgets this gets an empty doc, and would otherwise read that as a
		// convergence failure.
		const { timeline } = await recordExchange("rt3b");
		const inbound = timeline.filter((e) => e.kind === "receive" || e.kind === "connection");

		const result = await replayTimeline(inbound, { dbPrefix: "rt3b-replay" });

		expect(result.finalText["note-1"] ?? "").toBe("");
	});

	test("reports a divergence when replay does not reproduce a recorded flush", async () => {
		// A flush the replay cannot produce — no inbound content preceded it — is
		// exactly the shape of a real regression, and must be reported rather than
		// passing silently.
		const result = await replayTimeline(
			[
				{ seq: 0, kind: "connection", noteId: null, data: { connected: true } },
				{ seq: 1, kind: "flush", noteId: "note-9", data: { length: 42 } },
			],
			{ dbPrefix: "rt4" },
		);

		expect(result.divergences).toHaveLength(1);
		expect(result.divergences[0]).toMatchObject({ seq: 1, actual: "no flush" });
	});

	test("counts events it cannot act on instead of pretending they replayed", async () => {
		const result = await replayTimeline(
			[{ seq: 0, kind: "localEdit", noteId: "note-1", data: { hash: "unknown" } }],
			{ dbPrefix: "rt5" },
		);

		// A localEdit whose content is not supplied must NOT become an empty write
		// — that would silently rewrite the note to "" and invent a divergence.
		expect(result.skipped.localEdit).toBe(1);
		expect(result.divergences).toEqual([]);
	});

	test("replays a localEdit when its content is supplied by hash", async () => {
		const { timeline } = await recordExchange("rt6");
		const edit = timeline.find((e) => e.kind === "localEdit");
		const hash = edit?.data.hash as string;

		const result = await replayTimeline([edit as never], {
			dbPrefix: "rt6-replay",
			contentByHash: { [hash]: "hello world" },
		});

		expect(result.skipped.localEdit).toBeUndefined();
		expect(result.finalText["note-1"]).toBe("hello world");
	});
});

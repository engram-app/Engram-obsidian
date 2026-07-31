import { describe, expect, test } from "bun:test";
import { deserializeTimeline, SyncRecorder, serializeTimeline } from "../src/sync-recorder";

describe("SyncRecorder", () => {
	test("stamps a monotonic seq, not a clock reading", () => {
		// The load-bearing property. `[client:*]` log `time` is the batch-SHIP
		// stamp, so ordering a timeline by it scrambles causality — that trap cost
		// two debugging sessions. seq is assigned at record time and never
		// reordered.
		const rec = new SyncRecorder({ enabled: () => true });
		rec.record("receive", "n1", {});
		rec.record("send", "n2", {});
		rec.record("receive", "n1", {});

		expect(rec.timeline().map((e) => e.seq)).toEqual([0, 1, 2]);
	});

	test("seq keeps advancing across notes and event kinds", () => {
		const rec = new SyncRecorder({ enabled: () => true });
		for (let i = 0; i < 5; i++) rec.record("send", `n${i}`, {});

		expect(rec.timeline().at(-1)?.seq).toBe(4);
	});

	test("records nothing while disabled", () => {
		const rec = new SyncRecorder({ enabled: () => false });
		rec.record("receive", "n1", {});

		expect(rec.timeline()).toHaveLength(0);
	});

	test("picks up a flag flipped on at runtime without a reload", () => {
		let on = false;
		const rec = new SyncRecorder({ enabled: () => on });
		rec.record("receive", "n1", {});
		on = true;
		rec.record("receive", "n2", {});

		expect(rec.timeline().map((e) => e.noteId)).toEqual(["n2"]);
	});

	test("seq does not advance for suppressed events", () => {
		// Otherwise a timeline captured with recording toggled mid-session shows
		// gaps that read as dropped frames.
		let on = false;
		const rec = new SyncRecorder({ enabled: () => on });
		rec.record("receive", "skipped", {});
		on = true;
		rec.record("receive", "kept", {});

		expect(rec.timeline()[0].seq).toBe(0);
	});

	test("bounds the ring so a long session cannot grow it without limit", () => {
		const rec = new SyncRecorder({ enabled: () => true, capacity: 3 });
		for (let i = 0; i < 10; i++) rec.record("send", `n${i}`, {});

		const timeline = rec.timeline();
		expect(timeline).toHaveLength(3);
		// The retained window keeps its ORIGINAL seq numbers, so a truncated
		// timeline still says how much came before it.
		expect(timeline.map((e) => e.seq)).toEqual([7, 8, 9]);
	});

	test("filters a timeline down to one note", () => {
		const rec = new SyncRecorder({ enabled: () => true });
		rec.record("receive", "n1", {});
		rec.record("receive", "n2", {});
		rec.record("send", "n1", {});

		expect(rec.timeline("n1").map((e) => e.seq)).toEqual([0, 2]);
	});

	test("carries event detail through verbatim", () => {
		const rec = new SyncRecorder({ enabled: () => true });
		rec.record("send", "n1", { kind: "handshake", accepted: false });

		expect(rec.timeline()[0].data).toEqual({ kind: "handshake", accepted: false });
	});

	test("clear resets the buffer but not the seq counter", () => {
		// A cleared recorder must not restart numbering: two timelines from one
		// session would otherwise both start at 0 and look like the same events.
		const rec = new SyncRecorder({ enabled: () => true });
		rec.record("send", "n1", {});
		rec.clear();
		rec.record("send", "n2", {});

		expect(rec.timeline()[0].seq).toBe(1);
	});
});

describe("timeline serialization", () => {
	test("round-trips through JSON", () => {
		const rec = new SyncRecorder({ enabled: () => true });
		rec.record("receive", "n1", { frame: "AQID" });
		rec.record("localEdit", "n1", { hash: "abc", consumed: true });

		const restored = deserializeTimeline(serializeTimeline(rec.timeline()));

		expect(restored).toEqual(rec.timeline());
	});

	test("serializes to a stable, diffable shape", () => {
		const rec = new SyncRecorder({ enabled: () => true });
		rec.record("receive", "n1", { frame: "AQID" });

		expect(JSON.parse(serializeTimeline(rec.timeline()))).toEqual([
			{ seq: 0, kind: "receive", noteId: "n1", data: { frame: "AQID" } },
		]);
	});

	test("rejects a malformed timeline instead of half-loading it", () => {
		expect(() => deserializeTimeline('{"not":"an array"}')).toThrow();
		expect(() => deserializeTimeline("[{}]")).toThrow();
	});

	test("rejects an unknown event kind rather than typing it as valid", () => {
		// The cast at the parse boundary makes `kind` LOOK like the union to the
		// compiler; only this check makes it actually be one. Without it a replayer
		// that promises an exhaustive switch silently hits its default branch.
		const bogus = JSON.stringify([{ seq: 0, kind: "teleport", noteId: "n1", data: {} }]);

		expect(() => deserializeTimeline(bogus)).toThrow(/unknown kind/i);
	});

	test("rejects a timeline whose seq ordering was scrambled", () => {
		// A hand-edited or badly-merged fixture must not replay out of causal
		// order and produce a mystery divergence.
		const scrambled = JSON.stringify([
			{ seq: 3, kind: "receive", noteId: "n1", data: {} },
			{ seq: 1, kind: "receive", noteId: "n1", data: {} },
		]);

		expect(() => deserializeTimeline(scrambled)).toThrow(/seq/i);
	});
});

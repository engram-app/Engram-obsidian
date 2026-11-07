/**
 * Engram#2523 S4: the folder-op module. Each clearing event of the two
 * hiding layers (pending ops, held inbound changes) has its own test, per
 * docs/context/crdt-sync-store-hiding-layers.md: a layer that nothing clears
 * is permanent blindness.
 */
import { describe, expect, mock, test } from "bun:test";
import { MAX_ATTEMPTS, OP_TTL_MS } from "../src/crdt-op-queue";
import {
	type FolderChange,
	FolderIndex,
	type FolderOp,
	type FolderOpResult,
	FolderOps,
	HOLD_MAX_MS,
} from "../src/folder-ops";

function harness(results: FolderOpResult[] = []) {
	let now = 1_000;
	const sent: FolderOp[] = [];
	const applied: FolderChange[] = [];
	const fallbacks: [string, string][] = [];
	const acked: string[] = [];
	const ops = new FolderOps({
		send: mock(async (op: FolderOp) => {
			sent.push(op);
			return results.shift() ?? { kind: "ok", seq: 10 };
		}),
		now: () => now,
		vaultId: () => "v1",
		fallback: async (op, why) => {
			fallbacks.push([op.folder_id, why]);
		},
		acked: async (op) => {
			acked.push(op.folder_id);
		},
		apply: async (c) => {
			applied.push(c);
		},
		persist: () => {},
	});
	ops.index.load([
		{ id: "fa", parent_id: null, name: "A" },
		{ id: "fb", parent_id: null, name: "B" },
	]);
	return {
		ops,
		sent,
		applied,
		fallbacks,
		acked,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("FolderIndex", () => {
	test("derives paths through the parent chain; root is null", () => {
		const ix = new FolderIndex();
		ix.load([
			{ id: "1", parent_id: null, name: "a" },
			{ id: "2", parent_id: "1", name: "b" },
		]);
		expect(ix.pathFor("2")).toBe("a/b");
		expect(ix.idFor("a/b")).toBe("2");
		expect(ix.idFor("")).toBeNull();
		expect(ix.idFor("nope")).toBeUndefined();
	});

	test("a parent loop yields no path instead of spinning", () => {
		const ix = new FolderIndex();
		ix.load([
			{ id: "1", parent_id: "2", name: "a" },
			{ id: "2", parent_id: "1", name: "b" },
		]);
		expect(ix.pathFor("1")).toBeNull();
	});

	test("load keeps rows a pending op vouches for", () => {
		const ix = new FolderIndex();
		ix.set({ id: "1", parent_id: null, name: "moved-locally" });
		ix.load([{ id: "1", parent_id: null, name: "server-old" }], (id) => id === "1");
		expect(ix.pathFor("1")).toBe("moved-locally");
	});
});

describe("outbound folder ops", () => {
	test("a move is sent once, acked, and leaves nothing pending", async () => {
		const h = harness();
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.flush();
		expect(h.sent.map((o) => [o.op, o.folder_id, o.parent_id, o.name])).toEqual([
			["move", "fa", "fb", "A"],
		]);
		expect(h.acked).toEqual(["fa"]);
		expect(h.ops.hasPending("fa")).toBe(false);
		expect(h.ops.index.pathFor("fa")).toBe("B/A");
	});

	test("two queued moves of one folder coalesce, keeping the server's from", async () => {
		const h = harness();
		h.ops.move("fa", null, "A2", "A", "A2");
		h.ops.move("fa", "fb", "A3", "A2", "B/A3");
		expect(h.ops.all().map((o) => [o.name, o.from, o.to])).toEqual([["A3", "A", "B/A3"]]);
		h.ops.setFeature(true);
		await h.ops.flush();
		expect(h.sent).toHaveLength(1);
	});

	test("timeout: the op stays queued and is re-sent with the same op_id", async () => {
		const h = harness([{ kind: "retry" }]);
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.flush();
		expect(h.ops.hasPending("fa")).toBe(true);
		await h.ops.tick(); // still backing off: not re-sent yet
		expect(h.sent).toHaveLength(1);
		h.advance(1_000);
		await h.ops.tick();
		expect(h.sent.map((o) => o.op_id)).toEqual([h.sent[0]?.op_id, h.sent[0]?.op_id]);
		expect(h.ops.hasPending("fa")).toBe(false);
	});

	test("restart: a persisted op is replayed", async () => {
		const h = harness();
		h.ops.move("fa", "fb", "A", "A", "B/A");
		const saved = h.ops.all();
		const h2 = harness();
		h2.ops.load(saved);
		h2.ops.setFeature(true);
		await h2.ops.flush();
		expect(h2.sent.map((o) => o.op_id)).toEqual([saved[0]?.op_id]);
	});

	test("refusal clears the op and falls back per file", async () => {
		const h = harness([{ kind: "refused", reason: "cycle" }]);
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.flush();
		expect(h.fallbacks).toEqual([["fa", "cycle"]]);
		expect(h.ops.hasPending("fa")).toBe(false);
	});

	test("unknown_event falls back every queued op and turns folder ops off", async () => {
		const h = harness([{ kind: "unknown_event" }]);
		h.ops.setFeature(true);
		h.ops.move("fa", null, "A2", "A", "A2");
		h.ops.move("fb", null, "B2", "B", "B2");
		await h.ops.flush();
		expect(h.fallbacks.map(([id]) => id)).toEqual(["fa", "fb"]);
		expect(h.ops.enabled()).toBe(false);
		expect(h.sent).toHaveLength(1);
	});

	test("feature off after a reconnect: queued ops go per file", async () => {
		const h = harness();
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.setFeature(false);
		expect(h.fallbacks).toEqual([["fa", "feature_off"]]);
		expect(h.sent).toHaveLength(0);
	});

	test("an op from another vault is never sent", async () => {
		const h = harness();
		h.ops.load([
			{
				op: "move",
				op_id: "x",
				folder_id: "fa",
				parent_id: null,
				name: "A",
				from: "A",
				to: "A",
				vaultId: "other",
			},
		]);
		h.ops.setFeature(true);
		await h.ops.flush();
		expect(h.sent).toHaveLength(0);
		expect(h.ops.hasPending("fa")).toBe(false);
	});
});

describe("held inbound changes (a hiding layer: every clearing event)", () => {
	const change = (seq: number, name: string): FolderChange => ({
		id: "fa",
		parent_id: null,
		name,
		seq,
	});

	test("not held without a pending op", async () => {
		const h = harness();
		await h.ops.inbound(change(5, "X"));
		expect(h.applied.map((c) => c.name)).toEqual(["X"]);
	});

	test("ack: only changes the server made after our op apply", async () => {
		const h = harness([{ kind: "ok", seq: 10 }]);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.inbound(change(7, "older"));
		await h.ops.inbound(change(12, "newer"));
		expect(h.applied).toEqual([]);
		h.ops.setFeature(true);
		await h.ops.flush();
		expect(h.applied.map((c) => c.name)).toEqual(["newer"]);
	});

	test("ack with nothing newer applies nothing", async () => {
		const h = harness([{ kind: "ok", seq: 10 }]);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.inbound(change(7, "older"));
		h.ops.setFeature(true);
		await h.ops.flush();
		expect(h.applied).toEqual([]);
	});

	test("refusal: the newest held change applies", async () => {
		const h = harness([{ kind: "refused", reason: "conflict" }]);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.inbound(change(7, "one"));
		await h.ops.inbound(change(9, "two"));
		h.ops.setFeature(true);
		await h.ops.flush();
		expect(h.applied.map((c) => c.name)).toEqual(["two"]);
	});

	test("max age: a hold expires even if no answer ever comes", async () => {
		const h = harness([{ kind: "retry" }, { kind: "retry" }]);
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.inbound(change(7, "theirs"));
		await h.ops.flush();
		h.advance(HOLD_MAX_MS + 1);
		await h.ops.tick();
		expect(h.applied.map((c) => c.name)).toEqual(["theirs"]);
		expect(h.ops.hasPending("fa")).toBe(true);
	});

	test("reconnect drops the hold; the op is re-sent", async () => {
		const h = harness([{ kind: "retry" }]);
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.inbound(change(7, "theirs"));
		await h.ops.flush();
		await h.ops.onReconnect();
		expect(h.sent).toHaveLength(2);
		// After the ack, a fresh inbound change is no longer held.
		await h.ops.inbound(change(20, "later"));
		expect(h.applied.map((c) => c.name)).toEqual(["later"]);
	});

	test("vault reset drops queue, holds and index", async () => {
		const h = harness();
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.inbound(change(7, "theirs"));
		h.ops.reset();
		expect(h.ops.all()).toEqual([]);
		expect(h.ops.index.size()).toBe(0);
		await h.ops.inbound(change(8, "after"));
		expect(h.applied.map((c) => c.name)).toEqual(["after"]);
	});
});

// Adopted from the adversarial review of #689: red at f020b50d.
describe("hold expiry never drops OUR op (delta review #689)", () => {
	// Round 1 dropped the op on expiry; the delta review showed a merely slow
	// server then undid the user's own move. Only the server's answer (or a
	// fallback to per file) resolves our op; a late ack brings the disk back.
	test("expiry applies theirs, the op stays queued, and its ack is followed", async () => {
		const h = harness([{ kind: "retry" }, { kind: "retry" }, { kind: "ok", seq: 20 }]);
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.inbound({ id: "fa", parent_id: null, name: "Theirs", seq: 7 });
		await h.ops.flush();
		h.advance(HOLD_MAX_MS + 1);
		await h.ops.tick(); // applies "Theirs" locally; the re-send gets no answer
		expect(h.applied.map((c) => c.name)).toEqual(["Theirs"]);
		expect(h.ops.hasPending("fa")).toBe(true);
		h.advance(5_000);
		await h.ops.tick(); // the server answers ok
		expect(h.ops.hasPending("fa")).toBe(false);
		expect(h.acked).toEqual(["fa"]); // the engine's ack handler follows onto disk
	});
});

describe("FolderOps.learnServerLeaf (the crdt_create reply's folder_id)", () => {
	test("learns a folder whose parent is known; ignores one whose parent is not", () => {
		const h = harness();
		h.ops.learnServerLeaf("A/b", "2");
		h.ops.learnServerLeaf("x/y", "3");
		h.ops.learnServerLeaf("top", "4");
		expect(h.ops.index.idFor("A/b")).toBe("2");
		expect(h.ops.index.idFor("x/y")).toBeUndefined();
		expect(h.ops.index.idFor("top")).toBe("4");
	});
});

describe("the pending-op budget (round 3: MAX_ATTEMPTS / OP_TTL_MS, shared with the note-op queue)", () => {
	test("held (never sent) spends no attempt; the age cap still ends it (R4-4)", async () => {
		const results: FolderOpResult[] = Array.from({ length: 50 }, () => ({ kind: "held" }));
		const h = harness(results);
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		for (let i = 0; i < 4; i++) {
			h.advance(60_000);
			await h.ops.tick();
		}
		expect(h.ops.all()[0]?.attempts ?? 0).toBe(0);
		expect(h.fallbacks).toEqual([]);
		h.advance(2 * 60_000); // past OP_TTL_MS since enqueue
		await h.ops.tick();
		expect(h.fallbacks).toEqual([["fa", "ttl"]]);
		expect(h.ops.hasPending("fa")).toBe(false);
	});

	test("a restored op with no features reply ever still ends in the fallback (R4-4)", async () => {
		const h = harness();
		h.ops.load([
			{
				op: "move",
				op_id: "o1",
				folder_id: "fa",
				parent_id: "fb",
				name: "A",
				from: "A",
				to: "B/A",
				vaultId: "v1",
			},
		]);
		// setFeature never called: the user-topic join keeps failing.
		h.advance(OP_TTL_MS + 1);
		await h.ops.tick();
		expect(h.fallbacks).toEqual([["fa", "ttl"]]);
		expect(h.sent).toEqual([]);
	});

	test("rate_limited pauses the queue and spends nothing (the note-op queue's RateLimitPause, R4-5)", async () => {
		const results: FolderOpResult[] = [
			...Array.from({ length: MAX_ATTEMPTS + 4 }, () => ({ kind: "rate_limited" }) as const),
			{ kind: "ok", seq: 3 },
		];
		const h = harness(results);
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		h.ops.move("fb", null, "B2", "B", "B2");
		await h.ops.flush();
		// One reply paused the WHOLE queue: fb was not sent behind it.
		expect(h.sent.map((o) => o.folder_id)).toEqual(["fa"]);
		await h.ops.tick(); // still paused
		expect(h.sent).toHaveLength(1);
		for (let i = 0; i < MAX_ATTEMPTS + 4; i++) {
			h.advance(31_000);
			await h.ops.tick();
		}
		expect(h.fallbacks).toEqual([]);
		expect(h.acked).toContain("fa");
	});
	test("a restored op keeps its spent attempts (a crash loop is bounded too)", async () => {
		const h = harness([{ kind: "retry" }]);
		h.ops.load([
			{
				op: "move",
				op_id: "o1",
				folder_id: "fa",
				parent_id: "fb",
				name: "A",
				from: "A",
				to: "B/A",
				vaultId: "v1",
				attempts: MAX_ATTEMPTS - 1,
				queuedAt: 1_000,
			},
		]);
		h.ops.setFeature(true);
		await h.ops.flush();
		expect(h.fallbacks).toEqual([["fa", "max-attempts"]]);
		expect(h.ops.hasPending("fa")).toBe(false);
	});
});

describe("not_found is retried inside the budget (Engram#2533: a move racing a move)", () => {
	test("one not_found does not fall back; a retry that lands acks", async () => {
		const h = harness([
			{ kind: "refused", reason: "not_found" },
			{ kind: "ok", seq: 12 },
		]);
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.flush();
		expect(h.fallbacks).toEqual([]);
		expect(h.ops.hasPending("fa")).toBe(true);
		h.advance(1_000);
		await h.ops.tick();
		expect(h.acked).toEqual(["fa"]);
		expect(h.fallbacks).toEqual([]);
	});

	test("not_found every time ends in the fallback after MAX_ATTEMPTS, named by the refusal", async () => {
		const results: FolderOpResult[] = Array.from({ length: MAX_ATTEMPTS + 2 }, () => ({
			kind: "refused",
			reason: "not_found",
		}));
		const h = harness(results);
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
			h.advance(31_000); // past the max backoff, inside the age cap

			await h.ops.tick();
		}
		expect(h.sent).toHaveLength(MAX_ATTEMPTS);
		expect(h.fallbacks).toEqual([["fa", "not_found"]]);
	});

	test("conflict still falls back at once", async () => {
		const h = harness([{ kind: "refused", reason: "conflict" }]);
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.flush();
		expect(h.fallbacks).toEqual([["fa", "conflict"]]);
	});
});

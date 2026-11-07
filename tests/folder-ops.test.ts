/**
 * Engram#2523 S4: the folder-op module. Each clearing event of the two
 * hiding layers (pending ops, held inbound changes) has its own test, per
 * docs/context/crdt-sync-store-hiding-layers.md: a layer that nothing clears
 * is permanent blindness.
 */
import { describe, expect, mock, test } from "bun:test";
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
describe("review #689: hold expiry vs the still-pending op", () => {
	test("after an expired hold applies the server's state, no op may still move the folder elsewhere", async () => {
		const h = harness([{ kind: "retry" }, { kind: "retry" }, { kind: "ok", seq: 20 }]);
		h.ops.setFeature(true);
		h.ops.move("fa", "fb", "A", "A", "B/A");
		await h.ops.inbound({ id: "fa", parent_id: null, name: "Theirs", seq: 7 });
		await h.ops.flush();
		h.advance(HOLD_MAX_MS + 1);
		await h.ops.tick(); // applies "Theirs" locally
		expect(h.applied.map((c) => c.name)).toEqual(["Theirs"]);
		// Local disk is now at Theirs; a pending move to fb/A would make the server
		// diverge from it (our own folder_changed echo is dropped by device_id).
		expect(h.ops.hasPending("fa")).toBe(false);
	});
});

describe("FolderIndex.learn (the crdt_create reply)", () => {
	test("learns a folder whose parent is known; ignores one whose parent is not", () => {
		const ix = new FolderIndex();
		ix.load([{ id: "1", parent_id: null, name: "a" }]);
		ix.learn("a/b", "2");
		ix.learn("x/y", "3");
		expect(ix.idFor("a/b")).toBe("2");
		expect(ix.idFor("x/y")).toBeUndefined();
		ix.learn("top", "4");
		expect(ix.idFor("top")).toBe("4");
	});
});

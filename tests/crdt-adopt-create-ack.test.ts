/**
 * #377: the "server acked our crdt_create" bookkeeping existed THREE times in
 * sync.ts — pushFile's live genesis branch, applyCrdtCreateAck (durable queued
 * path), and recordCrdtGenesisPushed (batch path) — and one copy had already
 * leaked a step historically (the queued path missed the mint-retire the live
 * path did). These tests pin the ONE `adoptCreateAck` all three now call, so a
 * fourth divergence fails here instead of in production.
 *
 * What must hold, in order:
 *   1. the authoritative id is adopted into the noteIdMap
 *   2. the hasServerNote oracle flips (CRDT_HEAD_CREATED sentinel)
 *   3. the id is confirmed — this is what opens Task 1's canSendLive gate
 *   4. the echo baseline is stamped BEFORE the held-edit flush is awaited
 *   5. the held edits flush as ONE crdt_msg
 *
 * Step 4-before-5 is the ordering the queued path already had and the live
 * path did not: flushHeldEditsOnCreateAck is AWAITED, so stamping after it
 * leaves a window where our own echo returns before the baseline that
 * suppresses it exists.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { CRDT_HEAD_CREATED, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

type AnyEngine = Record<string, any>;

/** app/api are untouched by adoptCreateAck — it is pure local bookkeeping. */
function makeEngine(): AnyEngine {
	const engine = new SyncEngine(
		{} as any,
		{} as any,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	) as unknown as AnyEngine;
	engine.setNoteIdMap(new NoteIdMap());
	return engine;
}

/** Records the order of the bookkeeping steps adoptCreateAck drives. */
function traceEngine(): { engine: AnyEngine; order: string[] } {
	const engine = makeEngine();
	const order: string[] = [];
	const confirmNoteId = engine.confirmNoteId.bind(engine);
	engine.confirmNoteId = (id: string) => {
		order.push(`confirm:${id}`);
		confirmNoteId(id);
	};
	const recordCrdtBaseline = engine.recordCrdtBaseline.bind(engine);
	engine.recordCrdtBaseline = (np: string, content: string, opts?: unknown) => {
		order.push("baseline");
		recordCrdtBaseline(np, content, opts);
	};
	engine.flushHeldEditsOnCreateAck = async (id: string) => {
		order.push(`flush:${id}`);
	};
	return { engine, order };
}

describe("adoptCreateAck", () => {
	test("adopts the id, flips the oracle, confirms, and flushes", async () => {
		const { engine, order } = traceEngine();

		await engine.adoptCreateAck("server-1", "Notes/a.md", "hello");

		expect(engine.noteIdMap.get("Notes/a.md")).toBe("server-1");
		expect(engine.syncState.get("Notes/a.md")?.crdtHead).toBe(CRDT_HEAD_CREATED);
		expect(order).toEqual(["confirm:server-1", "baseline", "flush:server-1"]);
	});

	test("stamps the echo baseline BEFORE awaiting the held-edit flush", async () => {
		const { engine, order } = traceEngine();

		await engine.adoptCreateAck("server-1", "Notes/a.md", "seeded body");

		expect(order.indexOf("baseline")).toBeLessThan(order.indexOf("flush:server-1"));
	});

	test("confirms the id BEFORE flushing — the flush rides the canSendLive gate", async () => {
		const { engine, order } = traceEngine();

		await engine.adoptCreateAck("server-1", "Notes/a.md", "hello");

		expect(order.indexOf("confirm:server-1")).toBeLessThan(order.indexOf("flush:server-1"));
	});

	test("a null `consumed` stamps no baseline but still runs the rest", async () => {
		const { engine, order } = traceEngine();

		// The seed-declined / post-create-throw exits: nothing was transmitted,
		// so there is no echo to suppress. The row still exists server-side.
		await engine.adoptCreateAck("server-1", "Notes/a.md", null);

		expect(engine.noteIdMap.get("Notes/a.md")).toBe("server-1");
		expect(engine.syncState.get("Notes/a.md")?.crdtHead).toBe(CRDT_HEAD_CREATED);
		expect(order).toEqual(["confirm:server-1", "flush:server-1"]);
		// patchSyncedRow's default for a missing row — no content hash was stamped.
		expect(engine.syncState.get("Notes/a.md")?.hash).toBe(0);
	});

	test("flushHeld:false skips the flush (batch path seeds no local doc)", async () => {
		const { engine, order } = traceEngine();

		await engine.adoptCreateAck("server-1", "Notes/a.md", "batched body", {
			flushHeld: false,
		});

		expect(order).toEqual(["confirm:server-1", "baseline"]);
		expect(engine.syncState.get("Notes/a.md")?.crdtHead).toBe(CRDT_HEAD_CREATED);
	});

	test("the baseline merges onto the row at stamp time, not a stale snapshot", async () => {
		const { engine } = traceEngine();
		engine.syncState.set("Notes/a.md", { hash: 1, version: 7, serverHash: "abc" });

		await engine.adoptCreateAck("server-1", "Notes/a.md", "hello");

		const row = engine.syncState.get("Notes/a.md");
		expect(row.version).toBe(7); // a concurrent converged stamp is not dropped
		expect(row.serverHash).toBe("abc");
		expect(row.crdtHead).toBe(CRDT_HEAD_CREATED);
	});

	test("the map and the row are keyed by the SAME normalized path", async () => {
		const { engine } = traceEngine();

		// A doubled separator: enough to prove both writes route through
		// normalizePath, without depending on the mock matching Obsidian's
		// leading-slash trimming (it does not).
		await engine.adoptCreateAck("server-1", "Notes//a.md", "hello");

		expect(engine.noteIdMap.get("Notes/a.md")).toBe("server-1");
		expect(engine.syncState.get("Notes/a.md")?.crdtHead).toBe(CRDT_HEAD_CREATED);
	});
});

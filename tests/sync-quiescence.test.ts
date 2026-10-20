/**
 * The e2e harness waits on this snapshot instead of fixed sleeps: a device is
 * settled once its catch-up cursor has reached the server's change_seq and it
 * owes nothing outbound (no debounced push, queued op, in-flight flush or
 * create). Each field must reflect real engine state, or the barrier passes
 * while work is still pending.
 */
import { expect, mock, test } from "bun:test";
import type { EngramApi } from "../src/api";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function engine() {
	const app = {
		vault: { configDir: ".obsidian", getName: mock().mockReturnValue("V") },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	return new SyncEngine(
		app,
		{} as EngramApi,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	);
}

test("a fresh engine owes nothing and has caught up to seq 0", () => {
	expect(engine().quiescence()).toEqual({
		catchupSeq: 0,
		pulling: false,
		pushing: 0,
		pendingPushes: 0,
		queued: 0,
		flushing: 0,
		creating: 0,
	});
});

test("every kind of owed work shows up", () => {
	const e = engine();
	const raw = e as any;
	e.setCatchupSeq(42);
	raw.debounceTimers.set("a.md", 1);
	raw.pushing.add("b.md");
	raw.flushingHash.set("c.md", new Map([[1, 1]]));
	e.beginCreate("d.md");

	expect(e.quiescence()).toMatchObject({
		catchupSeq: 42,
		pushing: 1,
		pendingPushes: 1,
		flushing: 1,
		creating: 1,
	});

	raw.debounceTimers.clear();
});

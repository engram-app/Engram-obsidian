/**
 * Tests: a closed sync gate has to announce itself (#483).
 *
 * Local repro 2026-08-29: a device was repointed at a different backend and
 * vault. `computeSyncFingerprint` changed, so `applySyncGate` set
 * `syncBlocked`, and all twelve `syncBlocked` early-returns in sync.ts fired —
 * push, modify, delete, catch-up, replay. Obsidian went completely inert in
 * both directions for hours.
 *
 * The only signal was a status-bar label. That is not enough: the user reads
 * "my edits do nothing" as a broken sync engine, not as a gate waiting on them.
 * These pin that a blocked EDIT reports itself, exactly once per closure.
 */
import { describe, expect, test } from "bun:test";
import { SyncEngine } from "../src/sync";

/** A SyncEngine with only the fields `handleModify`'s gate branch touches. */
function blockedEngine() {
	const fired: number[] = [];
	const engine = Object.create(SyncEngine.prototype) as SyncEngine;
	Object.assign(engine, {
		syncBlocked: false,
		ready: true,
		blockedEditReported: false,
		onSyncBlockedEdit: () => fired.push(1),
	});
	return { engine, fired };
}

const file = { path: "Notes/gated.md" } as never;

describe("a blocked edit announces the gate", () => {
	test("the first edit while blocked reports once", () => {
		const { engine, fired } = blockedEngine();
		engine.setSyncBlocked(true);

		engine.handleModify(file);

		expect(fired.length).toBe(1);
	});

	test("further edits in the same closure stay quiet", () => {
		const { engine, fired } = blockedEngine();
		engine.setSyncBlocked(true);

		engine.handleModify(file);
		engine.handleModify(file);
		engine.handleModify(file);

		expect(fired.length).toBe(1);
	});

	test("reopening the gate re-arms it for the next closure", () => {
		const { engine, fired } = blockedEngine();

		engine.setSyncBlocked(true);
		engine.handleModify(file);
		engine.setSyncBlocked(false);
		engine.setSyncBlocked(true);
		engine.handleModify(file);

		expect(fired.length).toBe(2);
	});

	test("an open gate never reports", () => {
		const { engine, fired } = blockedEngine();
		engine.setSyncBlocked(false);

		// Not asserting what handleModify does past the gate — only that the
		// gate branch is not the one taken.
		try {
			engine.handleModify(file);
		} catch {
			// Downstream needs collaborators this fake does not have; irrelevant
			// here, and reaching them already proves the gate branch was skipped.
		}

		expect(fired.length).toBe(0);
	});
});

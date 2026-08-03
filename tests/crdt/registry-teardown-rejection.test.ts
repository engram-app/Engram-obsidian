/**
 * Deterministic repro for the teardown-during-hydration unhandled rejection
 * (#381), which otherwise shows up only as a load-sensitive ~1/8 flake that
 * Bun blames on whichever test happens to be running.
 *
 * Mechanism: `ProviderRegistry.destroy` ends the entry's Lifetime BEFORE any
 * await, deliberately, so in-flight work is abandoned rather than resuming into
 * a destroyed doc. `Lifetime.guard` therefore rejects every in-flight guarded
 * operation the instant `destroyAll` runs — including `entry()`'s wait on
 * IndexedDB hydration. A caller that fire-and-forgets `receive` without
 * observing that rejection leaks an unhandled rejection.
 *
 * Production observes it (`onCrdtMessage` in src/crdt/wiring.ts drops
 * `isDestroyedError` and re-surfaces everything else). The test transport in
 * provider-registry.test.ts did not, which is where the flake came from.
 *
 * These tests force the race directly instead of hoping the scheduler
 * reproduces it, so they fail deterministically if the rejection stops being
 * observable or stops being a DestroyedError.
 */
import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { isDestroyedError } from "../../src/crdt/destroyed-error";
import { ProviderRegistry } from "../../src/crdt/provider-registry";

function makeRegistry(dbPrefix: string): ProviderRegistry {
	return new ProviderRegistry({
		dbPrefix,
		send: () => true,
		onFlushToDisk: async () => {},
	});
}

describe("teardown during hydration (#381)", () => {
	test("an in-flight receive REJECTS when destroyAll lands mid-hydration", async () => {
		const reg = makeRegistry("teardown-inflight");
		reg.setConnected(true);

		// Start a receive but do NOT await it: entry() is now waiting on
		// lifetime.guard(entry.ready), i.e. IndexedDB hydration.
		//
		// The handler is attached HERE, at creation, not after the await below.
		// That ordering is the entire bug: attach it late and the rejection is
		// unhandled for the window in between, which is what Bun reports against
		// an unrelated test. Capturing the reason instead of rethrowing keeps
		// this test honest about what it is asserting.
		const inFlight = reg.receive("n1", "").then(
			() => null,
			(e: unknown) => e,
		);
		// End every lifetime while that wait is still outstanding.
		await reg.destroyAll();

		// The rejection must be a DestroyedError — that type is the whole
		// contract letting a caller distinguish "torn down" from a real fault.
		const reason = await inFlight;
		expect(reason).not.toBeNull();
		expect(isDestroyedError(reason)).toBe(true);
	});

	test("the production observer swallows exactly that and nothing else", async () => {
		const reg = makeRegistry("teardown-observer");
		reg.setConnected(true);

		// Mirror of wiring.ts's onCrdtMessage: drop DestroyedError, rethrow rest.
		const observed: unknown[] = [];
		const deliver = (id: string, frame: string) =>
			reg.receive(id, frame).catch((e: unknown) => {
				if (!isDestroyedError(e)) throw e;
				observed.push(e);
			});

		const guarded = deliver("n1", "");
		await reg.destroyAll();

		// Resolves rather than rejecting — nothing escapes to become an
		// unhandled rejection, which is what made this a cross-test flake.
		await expect(guarded).resolves.toBeUndefined();
		expect(observed).toHaveLength(1);
		expect(isDestroyedError(observed[0])).toBe(true);
	});
});

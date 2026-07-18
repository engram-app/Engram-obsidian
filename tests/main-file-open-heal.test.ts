/**
 * Tests: handleFileOpen (main.ts) — rework #6, the file-open wiring for the
 * restored mid-session divergence heal. See
 * .superpowers/sdd/rework-design.md "#6 — verifyConvergenceOnOpen removal
 * dropped the mid-session heal".
 *
 * The old per-open synchronous REST manifest-hash check (verifyConvergenceOnOpen)
 * caused the file-open LAG that got it deleted. The replacement must keep the
 * instant local bind synchronous and fire the heal WITHOUT blocking or
 * awaiting it from the event handler — these tests pin that shape: the bind
 * always runs, the heal is fired-and-forgotten (not awaited), and only for
 * markdown files.
 *
 * Uses the same `EngramSyncPlugin.prototype.<method>.call(fakeThis, ...)`
 * pattern as tests/main-oauth-token-rebind.test.ts / main-catchup-wiring.test.ts
 * — handleFileOpen is private (genuinely internal), so this cast bypasses the
 * compile-time visibility check without loosening it for production callers.
 */
import { describe, expect, mock, test } from "bun:test";
import { TFile } from "obsidian";
import EngramSyncPlugin from "../src/main";

function callHandleFileOpen(fakeThis: unknown, file: TFile | null): void {
	(
		EngramSyncPlugin.prototype as unknown as {
			handleFileOpen: (f: TFile | null) => void;
		}
	).handleFileOpen.call(fakeThis as never, file);
}

describe("handleFileOpen", () => {
	test("refreshes the local CRDT bind synchronously and fires healNoteOnOpen without awaiting it", async () => {
		const refresh = mock();
		let healResolved = false;
		let resolveHeal: (() => void) | undefined;
		const healNoteOnOpen = mock(
			() =>
				new Promise<void>((resolve) => {
					resolveHeal = () => {
						healResolved = true;
						resolve();
					};
				}),
		);
		const fakeThis = {
			crdtLiveViews: { refresh },
			syncEngine: { healNoteOnOpen },
		};
		const file = new TFile("Notes/a.md");

		callHandleFileOpen(fakeThis, file);

		// Local bind ran synchronously.
		expect(refresh).toHaveBeenCalledTimes(1);
		// Heal was fired, but the handler did NOT wait on it — still pending here.
		expect(healNoteOnOpen).toHaveBeenCalledWith("Notes/a.md");
		expect(healResolved).toBe(false);

		resolveHeal?.();
		await Promise.resolve();
		expect(healResolved).toBe(true);
	});

	test("a null file (no active leaf) only refreshes — no heal call", () => {
		const refresh = mock();
		const healNoteOnOpen = mock().mockResolvedValue(undefined);
		const fakeThis = {
			crdtLiveViews: { refresh },
			syncEngine: { healNoteOnOpen },
		};

		callHandleFileOpen(fakeThis, null);

		expect(refresh).toHaveBeenCalledTimes(1);
		expect(healNoteOnOpen).not.toHaveBeenCalled();
	});

	test("a non-markdown file (e.g. canvas) only refreshes — no heal call", () => {
		const refresh = mock();
		const healNoteOnOpen = mock().mockResolvedValue(undefined);
		const fakeThis = {
			crdtLiveViews: { refresh },
			syncEngine: { healNoteOnOpen },
		};

		callHandleFileOpen(fakeThis, new TFile("Board.canvas"));

		expect(refresh).toHaveBeenCalledTimes(1);
		expect(healNoteOnOpen).not.toHaveBeenCalled();
	});

	test("crdtLiveViews not yet wired (early lifecycle) — no throw", () => {
		const healNoteOnOpen = mock().mockResolvedValue(undefined);
		const fakeThis = { crdtLiveViews: undefined, syncEngine: { healNoteOnOpen } };

		expect(() => callHandleFileOpen(fakeThis, new TFile("Notes/a.md"))).not.toThrow();
		expect(healNoteOnOpen).toHaveBeenCalledWith("Notes/a.md");
	});
});

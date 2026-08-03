/**
 * Tests: handleSyncError — the shared error boundary for user-initiated sync
 * entry points (palette commands, status-bar click, startup sync, sync after
 * settings change).
 *
 * The bug this locks in: the palette commands (sync-now, push-all, check-sync,
 * pull-all) had NO error handling, so a free-tier user hitting the cap via the
 * palette got an unhandled rejection and no toast, while the status-bar click
 * for the identical operation showed the upgrade toast. All entry points must
 * route through one boundary.
 *
 * Uses the same `Object.create(EngramSyncPlugin.prototype)` pattern as
 * main-catchup-wiring.test.ts: the real private method runs against a bare
 * fake `this`.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { LimitExceededError } from "../src/limit-error";
import EngramSyncPlugin from "../src/main";
import { __noticeCapture } from "./__mocks__/obsidian";

type WithBoundary = {
	handleSyncError(context: string, e: unknown, opts?: { notice?: boolean }): void;
};

function plugin(): WithBoundary {
	return Object.create(EngramSyncPlugin.prototype) as unknown as WithBoundary;
}

describe("handleSyncError", () => {
	beforeEach(() => {
		__noticeCapture.notices.length = 0;
	});

	test("LimitExceededError renders the upgrade toast", () => {
		const err = new LimitExceededError(
			"notes_cap_exceeded",
			"https://app.engram.page/settings/billing",
			"notes_cap",
			10000,
			10000,
		);
		plugin().handleSyncError("Manual sync", err, { notice: true });
		expect(__noticeCapture.notices).toHaveLength(1);
		expect(__noticeCapture.notices[0].message.toLowerCase()).toMatch(/note limit/);
	});

	test("generic error with notice:true shows a failure Notice", () => {
		plugin().handleSyncError("Manual sync", new Error("boom"), { notice: true });
		expect(__noticeCapture.notices).toHaveLength(1);
		expect(__noticeCapture.notices[0].message).toMatch(/sync failed/i);
	});

	test("generic error without notice stays silent (background sync must not toast offline users)", () => {
		plugin().handleSyncError("Startup sync", new Error("net down"));
		expect(__noticeCapture.notices).toHaveLength(0);
	});

	test("never throws (it IS the error boundary)", () => {
		expect(() =>
			plugin().handleSyncError("Manual sync", undefined, { notice: true }),
		).not.toThrow();
	});
});

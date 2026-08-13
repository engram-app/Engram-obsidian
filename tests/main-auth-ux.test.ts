/**
 * Tests: auth-failure surfacing (#420 P2).
 *
 * Prod 2026-08-12: the token family was revoked mid-first-sync. The status bar
 * kept saying "Engram: ready" with a click that silently did nothing, the open
 * preview modal spun for 8s then blamed the connection, and nothing anywhere
 * said "sign in again". These pin the honest states.
 */
import { describe, expect, test } from "bun:test";
import EngramSyncPlugin from "../src/main";
import { planLoadErrorMessage } from "../src/sync-preview-modal";
import type { SyncStatus } from "../src/types";

describe("planLoadErrorMessage", () => {
	test("auth configured → connection copy; signed out → sign-in copy", () => {
		expect(planLoadErrorMessage(true)).toMatch(/connection/i);
		expect(planLoadErrorMessage(false)).toMatch(/sign in/i);
		// The signed-out copy must never blame the network — that's the lie the
		// incident shipped.
		expect(planLoadErrorMessage(false)).not.toMatch(/connection/i);
	});
});

describe("status bar when signed out", () => {
	function fakeFor(settings: Record<string, unknown>) {
		const texts: string[] = [];
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings,
			statusBarEl: {
				setText(t: string) {
					texts.push(t);
				},
				setAttribute(_k: string, _v: string) {},
			},
			syncEngine: {
				isSyncBlocked() {
					return false;
				},
			},
			syncLog: null,
			liveConnected: false,
		});
		return { fake, texts };
	}
	const idle: SyncStatus = { state: "idle", pending: 0, queued: 0 } as SyncStatus;

	test("no auth configured → says signed out, not ready", () => {
		const { fake, texts } = fakeFor({});
		(
			EngramSyncPlugin.prototype as unknown as {
				updateStatusBar(this: unknown, s: SyncStatus): void;
			}
		).updateStatusBar.call(fake, idle);
		expect(texts[0]).toMatch(/signed out/i);
	});

	test("auth configured → unchanged ready state", () => {
		const { fake, texts } = fakeFor({ apiUrl: "https://api", refreshToken: "rt" });
		(
			EngramSyncPlugin.prototype as unknown as {
				updateStatusBar(this: unknown, s: SyncStatus): void;
			}
		).updateStatusBar.call(fake, idle);
		expect(texts[0]).toBe("Engram: ready");
	});
});

describe("clearAuthAndPromptRelink surfaces into an open preview modal", () => {
	test("sets the sign-in plan error on the open modal", async () => {
		const planErrors: string[] = [];
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings: { refreshToken: "rt" } as Record<string, unknown>,
			api: { setAuthProvider(_p: unknown) {} },
			authProvider: null,
			noteStream: null,
			liveConnected: false,
			everConnected: false,
			openPreviewModal: {
				setPlanError(msg: string) {
					planErrors.push(msg);
				},
			},
			async savePluginData(_ls: unknown) {},
			syncEngine: {
				getLastSync() {
					return 0;
				},
				getStatus() {
					return { state: "idle", pending: 0, queued: 0 };
				},
			},
			updateStatusBar(_s: unknown) {},
		});

		await (
			EngramSyncPlugin.prototype as unknown as {
				clearAuthAndPromptRelink(reason: string, notify: boolean): Promise<void>;
			}
		).clearAuthAndPromptRelink.call(fake, "test", false);

		// The open modal must flip to the sign-in error instead of spinning
		// until the enumerate budget expires and blaming the connection.
		expect(planErrors).toEqual([planLoadErrorMessage(false)]);
	});
});

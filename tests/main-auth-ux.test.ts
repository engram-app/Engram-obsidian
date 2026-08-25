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
	// The 2026-08-12 incident is a user who WAS working and then got forcibly
	// signed out — so they have a lastSync. That is what makes "signed out" the
	// right words for them, and what distinguishes them from someone who never
	// linked at all (covered separately below).
	const idleAfterWorking: SyncStatus = {
		...idle,
		lastSync: "2026-08-12T00:00:00Z",
	} as SyncStatus;

	test("no auth configured → says signed out, not ready", () => {
		const { fake, texts } = fakeFor({});
		(
			EngramSyncPlugin.prototype as unknown as {
				updateStatusBar(this: unknown, s: SyncStatus): void;
			}
		).updateStatusBar.call(fake, idleAfterWorking);
		expect(texts[0]).toMatch(/signed out/i);
		expect(texts[0]).not.toMatch(/ready/i);
	});

	// A user who never linked was never signed IN, so "signed out" reads like
	// something broke rather than something is unfinished. Same protection —
	// still never "ready" — different words.
	test("never synced → says not connected, still not ready", () => {
		const { fake, texts } = fakeFor({});
		(
			EngramSyncPlugin.prototype as unknown as {
				updateStatusBar(this: unknown, s: SyncStatus): void;
			}
		).updateStatusBar.call(fake, idle);
		expect(texts[0]).toMatch(/not connected/i);
		expect(texts[0]).not.toMatch(/ready/i);
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
		let vaultWipes = 0;
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings: { refreshToken: "rt" } as Record<string, unknown>,
			api: { setAuthProvider(_p: unknown) {}, setVaultId(_v: unknown) {} },
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
				async resetForVaultChange() {
					vaultWipes++;
				},
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
		// #1409 review: `withClearedAuth` nulls `vaultId`, so this IS a vault
		// change. Re-linking to a different account or a second vault used to
		// inherit the previous vault's note-id map.
		expect(vaultWipes).toBe(1);
		expect(fake.settings.vaultId).toBeNull();
	});
});

describe("round-1 review fixes (#422)", () => {
	test("signed-out status wins over the sync-error override", () => {
		const texts: string[] = [];
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings: {},
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
			// Dead auth PRODUCES logged sync errors — the exact state the
			// signed-out branch exists for must not be masked by the error badge.
			syncLog: {
				errorCount() {
					return 3;
				},
			},
			liveConnected: false,
		});
		(
			EngramSyncPlugin.prototype as unknown as {
				updateStatusBar(this: unknown, s: SyncStatus): void;
			}
		).updateStatusBar.call(fake, {
			state: "idle",
			pending: 0,
			queued: 0,
			// Had been syncing before the forced sign-out — that is the incident.
			lastSync: "2026-08-12T00:00:00Z",
		} as SyncStatus);
		expect(texts[0]).toMatch(/signed out/i);
		// The point of the guard: the error badge must not overwrite it.
		expect(texts[0]).not.toMatch(/sync errors/i);
	});

	test("trackPreviewModal registers a modal for the auth poke; untrack clears it", async () => {
		const planErrors: string[] = [];
		const modal = {
			close() {},
			setPlanError(msg: string) {
				planErrors.push(msg);
			},
		};
		const proto = EngramSyncPlugin.prototype as unknown as {
			trackPreviewModal(this: unknown, m: unknown): void;
			untrackPreviewModal(this: unknown, m: unknown): void;
			clearAuthAndPromptRelink(this: unknown, reason: string, notify: boolean): Promise<void>;
		};
		const base = {
			settings: { refreshToken: "rt" } as Record<string, unknown>,
			api: { setAuthProvider(_p: unknown) {}, setVaultId(_v: unknown) {} },
			authProvider: null,
			noteStream: null,
			liveConnected: false,
			everConnected: false,
			openPreviewModal: null as unknown,
			async savePluginData(_ls: unknown) {},
			syncEngine: {
				async resetForVaultChange() {},
				getLastSync() {
					return 0;
				},
				getStatus() {
					return { state: "idle", pending: 0, queued: 0 };
				},
			},
			updateStatusBar(_s: unknown) {},
		};
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), base);

		proto.trackPreviewModal.call(fake, modal);
		await proto.clearAuthAndPromptRelink.call(fake, "test", false);
		expect(planErrors).toEqual([planLoadErrorMessage(false)]);

		const fake2 = Object.assign(Object.create(EngramSyncPlugin.prototype), base, {
			settings: { refreshToken: "rt" },
		});
		proto.trackPreviewModal.call(fake2, modal);
		proto.untrackPreviewModal.call(fake2, modal);
		planErrors.length = 0;
		await proto.clearAuthAndPromptRelink.call(fake2, "test", false);
		expect(planErrors).toEqual([]);
	});

	test("no em dashes in the new user-facing copy", () => {
		expect(planLoadErrorMessage(true)).not.toContain("\u2014");
		expect(planLoadErrorMessage(false)).not.toContain("\u2014");
	});
});

describe("opening the sync gate re-runs the catch-up (#425)", () => {
	// While the gate is shut, catchupViaSeqReplay now bails before walking, so
	// no feed rows are consumed and the cursor is preserved. That is correct —
	// but it means the rows are still WAITING when the gate opens, and nothing
	// was asking for them: markSyncGateAccepted re-fired STEP1 enrollment and
	// then stopped. The pull only happened if the user separately triggered a
	// FullSync, which is precisely the path that failed in prod on 2026-08-13.
	const fakePlugin = () => {
		const calls: string[] = [];
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings: {
				refreshToken: "rt",
				userEmail: "a@b.test",
				vaultId: "v1",
				apiKey: "",
			},
			syncGateAcceptedFor: null,
			syncEngine: {
				setSyncBlocked(v: boolean) {
					calls.push(`setSyncBlocked(${v})`);
				},
				getLastSync: () => 0,
				getStatus: () => ({ state: "idle", pending: 0, queued: 0 }),
				catchupViaSeqReplay: async () => {
					calls.push("catchupViaSeqReplay");
					return {};
				},
			},
			crdtEnrollment: {
				resetAll() {
					calls.push("resetAll");
				},
			},
			async savePluginData() {},
			updateStatusBar() {},
		});
		return { fake, calls };
	};

	test("markSyncGateAccepted unblocks AND pulls what the gate held back", async () => {
		const { fake, calls } = fakePlugin();

		await fake.markSyncGateAccepted();

		expect(calls).toContain("setSyncBlocked(false)");
		expect(calls).toContain("catchupViaSeqReplay");
		// Order matters: pulling before the unblock would bail on the closed gate.
		expect(calls.indexOf("setSyncBlocked(false)")).toBeLessThan(
			calls.indexOf("catchupViaSeqReplay"),
		);
	});

	test("an empty fingerprint neither unblocks nor pulls", async () => {
		const { fake, calls } = fakePlugin();
		fake.settings = { refreshToken: "", userEmail: "", vaultId: "", apiKey: "" };

		await fake.markSyncGateAccepted();

		expect(calls).toEqual([]);
	});
});

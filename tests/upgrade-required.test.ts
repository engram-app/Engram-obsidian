/**
 * The client half of the backend's minimum-plugin-version floor.
 *
 * Every case here guards a SILENT failure: if the 426 branch or the join-reason
 * branch stops firing, the user gets sync that fails forever with no
 * explanation, and nothing in the logs looks different from an outage.
 */
import { afterEach, beforeEach, describe, expect, type Mock, mock, test } from "bun:test";
import { requestUrl } from "obsidian";
import { EngramApi } from "../src/api";
import { NoteChannel } from "../src/channel";
import EngramSyncPlugin from "../src/main";
import { RemoteLogger } from "../src/remote-log";
import type { SyncStatus } from "../src/types";
import {
	clearUpgradeRefusal,
	isUpgradeRequired,
	notifyUpgradeRequired,
	resetUpgradeRequired,
	setUpgradeAction,
	setUpgradeStateListener,
	upgradeRequiredMinVersion,
} from "../src/upgrade-required";
import { __noticeCapture } from "./__mocks__/obsidian";

const mockRequestUrl = requestUrl as unknown as Mock<() => Promise<any>>;

beforeEach(() => {
	__noticeCapture.notices.length = 0;
	mockRequestUrl.mockReset();
	resetUpgradeRequired();
});

afterEach(() => resetUpgradeRequired());

describe("notifyUpgradeRequired", () => {
	test("names the minimum version so the user can tell if they already updated", () => {
		notifyUpgradeRequired("1.29.0");

		expect(__noticeCapture.notices).toHaveLength(1);
		const n = __noticeCapture.notices[0];
		expect(n.message).toMatch(/too old/i);
		expect(n.message).toContain("1.29.0");
		expect(n.duration).toBeGreaterThanOrEqual(10_000);
	});

	test("still says something useful when the body carried no version", () => {
		notifyUpgradeRequired(null);

		expect(__noticeCapture.notices[0].message).toMatch(/too old/i);
	});

	// Every refused request and every reconnect would otherwise toast.
	test("latches to one notice per session", () => {
		notifyUpgradeRequired("1.29.0");
		notifyUpgradeRequired("1.29.0");
		notifyUpgradeRequired("1.30.0");

		expect(__noticeCapture.notices).toHaveLength(1);
		expect(isUpgradeRequired()).toBe(true);
	});

	test("the button is labelled Update, not Upgrade", () => {
		// The 402 toast next door says "Upgrade" and means "pay more". A user
		// who reads this one as a sales prompt will dismiss it and stay broken.
		setUpgradeAction(() => {});
		notifyUpgradeRequired("1.29.0");

		expect(__noticeCapture.notices[0].buttons).toHaveLength(1);
		expect(__noticeCapture.notices[0].buttons[0].text).toBe("Update");
	});

	test("the button runs the injected action", () => {
		const action = mock(() => {});
		setUpgradeAction(action);
		notifyUpgradeRequired("1.29.0");

		__noticeCapture.notices[0].buttons[0].click();

		expect(action).toHaveBeenCalledTimes(1);
	});

	test("renders no button when no action was wired", () => {
		notifyUpgradeRequired("1.29.0");

		expect(__noticeCapture.notices[0].buttons).toHaveLength(0);
	});
});

describe("REST 426", () => {
	test("a refused request notifies and still rejects", async () => {
		mockRequestUrl.mockRejectedValueOnce({
			status: 426,
			json: {
				error: "plugin_upgrade_required",
				min_version: "1.29.0",
				your_version: "1.10.0",
			},
		});

		const api = new EngramApi("https://api.example.com", "key");

		// Shape asserted, not just "it threw": the contract is that a 426 is
		// rethrown UNCHANGED. `toBeDefined()` passed even when the error was
		// replaced wholesale.
		await expect(api.getManifest()).rejects.toMatchObject({ status: 426 });
		expect(__noticeCapture.notices).toHaveLength(1);
		expect(__noticeCapture.notices[0].message).toContain("1.29.0");
	});

	test("reads a body that arrived as raw text", async () => {
		mockRequestUrl.mockRejectedValueOnce({
			status: 426,
			text: JSON.stringify({ min_version: "1.31.0" }),
		});

		const api = new EngramApi("https://api.example.com", "key");

		// Shape asserted, not just "it threw": the contract is that a 426 is
		// rethrown UNCHANGED. `toBeDefined()` passed even when the error was
		// replaced wholesale.
		await expect(api.getManifest()).rejects.toMatchObject({ status: 426 });
		expect(__noticeCapture.notices[0].message).toContain("1.31.0");
	});

	test("a malformed body still notifies rather than crashing the error path", async () => {
		mockRequestUrl.mockRejectedValueOnce({ status: 426, text: "<html>nope" });

		const api = new EngramApi("https://api.example.com", "key");

		// Shape asserted, not just "it threw": the contract is that a 426 is
		// rethrown UNCHANGED. `toBeDefined()` passed even when the error was
		// replaced wholesale.
		await expect(api.getManifest()).rejects.toMatchObject({ status: 426 });
		expect(__noticeCapture.notices).toHaveLength(1);
	});

	// The shape a real launch produces. Server-side `Auth` runs BEFORE
	// `RequirePluginVersion`, so a stale cached token yields 401-then-426 —
	// the 426 lands on the single-shot retry path, not the primary one.
	// That path handled 402 and not 426, so the notice never fired at all.
	test("a 426 arriving on the 401 retry still notifies", async () => {
		const api = new EngramApi("https://api.example.com", "key");
		api.setAuthProvider({
			getToken: async () => "token",
			getVaultId: () => null,
			isAuthenticated: () => true,
			signOut: () => {},
			invalidateAccessToken: () => {},
		} as any);

		mockRequestUrl.mockRejectedValueOnce({ status: 401, text: "unauthorized" });
		mockRequestUrl.mockRejectedValueOnce({
			status: 426,
			json: { min_version: "1.29.0" },
		});

		await expect(api.getManifest()).rejects.toMatchObject({ status: 426 });

		expect(__noticeCapture.notices).toHaveLength(1);
		expect(__noticeCapture.notices[0].message).toContain("1.29.0");
	});

	test("other statuses do not trip it", async () => {
		mockRequestUrl.mockRejectedValueOnce({ status: 500, text: "boom" });

		const api = new EngramApi("https://api.example.com", "key");

		await expect(api.getManifest()).rejects.toMatchObject({ status: 500 });
		expect(__noticeCapture.notices).toHaveLength(0);
		expect(isUpgradeRequired()).toBe(false);
	});
});

// A 426 is permanent until the plugin is updated, and updating means a reload.
// Prod 2026-10-18: one below-floor install POSTed /api/logs 1,330 times in 12h,
// every one a 426, because the remote logger re-buffers a failed batch and the
// api layer sent each retry. Once refused, nothing should reach the wire.
describe("REST after a 426 refusal", () => {
	const refusal = () => ({
		status: 426,
		json: { error: "plugin_upgrade_required", min_version: "1.29.0" },
	});
	const ok = () => ({ status: 200, json: {}, text: "{}", headers: {} });

	test("a 426 on the logs endpoint stops every later log push", async () => {
		mockRequestUrl.mockRejectedValueOnce(refusal());
		const api = new EngramApi("https://api.example.com", "key");

		await expect(api.pushLogs([])).rejects.toMatchObject({ status: 426 });
		for (let i = 0; i < 5; i++) {
			await expect(api.pushLogs([])).rejects.toMatchObject({ status: 426 });
		}

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		expect(__noticeCapture.notices).toHaveLength(1);
	});

	test("a 426 on a sync call stops log pushes and sync calls alike", async () => {
		mockRequestUrl.mockRejectedValueOnce(refusal());
		const api = new EngramApi("https://api.example.com", "key");

		await expect(api.getManifest()).rejects.toMatchObject({ status: 426 });
		await expect(api.pushLogs([])).rejects.toMatchObject({ status: 426 });
		await expect(api.getManifest()).rejects.toMatchObject({ status: 426 });

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});

	test("a socket join refusal stops REST too, with no 426 ever seen on REST", async () => {
		notifyUpgradeRequired("1.29.0");
		const api = new EngramApi("https://api.example.com", "key");

		await expect(api.pushLogs([])).rejects.toMatchObject({ status: 426 });
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});

	test("the remote logger's flush loop sends exactly one request", async () => {
		mockRequestUrl.mockRejectedValueOnce(refusal());
		const api = new EngramApi("https://api.example.com", "key");
		const logger = new RemoteLogger();
		logger.configure((entries) => api.pushLogs(entries), "1.10.0", "desktop");
		logger.setEnabled(true);

		try {
			for (let i = 0; i < 20; i++) {
				logger.warn("test", `entry ${i}`);
				await logger.flush();
			}
		} finally {
			logger.setEnabled(false);
		}

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});

	test("recovery is not attempted until reload, then traffic resumes", async () => {
		mockRequestUrl.mockRejectedValueOnce(refusal());
		const api = new EngramApi("https://api.example.com", "key");
		await expect(api.getManifest()).rejects.toMatchObject({ status: 426 });

		// No timer, no backoff probe: still nothing after many attempts.
		for (let i = 0; i < 10; i++) {
			await expect(api.pushLogs([])).rejects.toMatchObject({ status: 426 });
		}
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);

		// Plugin reload (fresh module state) is the only reset.
		resetUpgradeRequired();
		mockRequestUrl.mockResolvedValueOnce(ok());
		await api.pushLogs([]);
		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});

	test("the trace beacon is dropped once refused", () => {
		const api = new EngramApi("https://api.example.com", "key");
		const internals = api as unknown as {
			tracingEnabled: boolean;
			lastToken: string;
			beacon: { transport: () => unknown };
		};
		internals.tracingEnabled = true;
		internals.lastToken = "tok";
		notifyUpgradeRequired("1.29.0");

		expect(internals.beacon.transport()).toBeNull();
	});
});

describe("channel join refusal", () => {
	class FakeWS {
		static last: FakeWS | null = null;
		static OPEN = 1;
		onopen: (() => void) | null = null;
		onclose: (() => void) | null = null;
		onerror: (() => void) | null = null;
		onmessage: ((e: { data: string }) => void) | null = null;
		readyState = 0;
		constructor(_url: string) {
			FakeWS.last = this;
		}
		close() {}
		send() {}
	}

	const joinError = (topic: string, reason: string, minVersion?: string) =>
		JSON.stringify([
			null,
			"1",
			topic,
			"phx_reply",
			{
				status: "error",
				response: { reason, ...(minVersion ? { min_version: minVersion } : {}) },
			},
		]);

	beforeEach(() => {
		// @ts-expect-error test shim
		global.WebSocket = FakeWS;
		FakeWS.last = null;
	});

	// Checked for EVERY topic. The floor refuses sync: and crdt: alike, and the
	// crdt-only path would miss a sync: refusal entirely.
	test("a sync: topic refusal notifies", async () => {
		const ch = new NoteChannel("http://x", "key", "user-1", "vault-9", "dev-1");
		await ch.connect();

		FakeWS.last?.onmessage?.({
			data: joinError("sync:user-1:vault-9", "plugin_upgrade_required", "1.29.0"),
		});

		expect(__noticeCapture.notices).toHaveLength(1);
		expect(__noticeCapture.notices[0].message).toContain("1.29.0");
	});

	test("an unrelated join reason does not trip it", async () => {
		const ch = new NoteChannel("http://x", "key", "user-1", "vault-9", "dev-1");
		await ch.connect();

		FakeWS.last?.onmessage?.({
			data: joinError("sync:user-1:vault-9", "onboarding_required"),
		});

		expect(__noticeCapture.notices).toHaveLength(0);
		expect(isUpgradeRequired()).toBe(false);
	});

	// Only the sync: join is gated by the floor. A user: join (no version gate)
	// or a crdt: ack must not read as "admitted".
	test("an ok reply on user: or crdt: does not clear the refusal", async () => {
		const ch = new NoteChannel("http://x", "key", "user-1", "vault-9", "dev-1");
		await ch.connect();
		FakeWS.last?.onmessage?.({
			data: joinError("sync:user-1:vault-9", "plugin_upgrade_required", "1.36.0"),
		});
		for (const topic of ["user:user-1", "crdt:user-1:vault-9"]) {
			FakeWS.last?.onmessage?.({
				data: JSON.stringify([
					null,
					"3",
					topic,
					"phx_reply",
					{ status: "ok", response: {} },
				]),
			});
		}
		expect(isUpgradeRequired()).toBe(true);
	});

	// Clearing event: the server admitted a sync: join, so its floor no longer
	// refuses us (floor lowered, or a rolling deploy reached an older node).
	// The notice is NOT re-armed: a flapping fleet must not toast per flip.
	test("a later successful sync: join clears the refusal without a second notice", async () => {
		const ch = new NoteChannel("http://x", "key", "user-1", "vault-9", "dev-1");
		await ch.connect();
		FakeWS.last?.onmessage?.({
			data: joinError("sync:user-1:vault-9", "plugin_upgrade_required", "1.36.0"),
		});
		expect(isUpgradeRequired()).toBe(true);

		FakeWS.last?.onmessage?.({
			data: JSON.stringify([
				null,
				"2",
				"sync:user-1:vault-9",
				"phx_reply",
				{ status: "ok", response: {} },
			]),
		});
		expect(isUpgradeRequired()).toBe(false);

		FakeWS.last?.onmessage?.({
			data: joinError("sync:user-1:vault-9", "plugin_upgrade_required", "1.36.0"),
		});
		expect(isUpgradeRequired()).toBe(true);
		expect(__noticeCapture.notices).toHaveLength(1);
	});
});

// A 426 is a generic HTTP status: a proxy in front of a self-hosted backend can
// emit a bare one. Updating cannot fix that, so it must not brick the plugin
// until reload. Only the server's own floor body latches the local refusal.
describe("refusal latch scope", () => {
	const ok = () => ({ status: 200, json: {}, text: "{}", headers: {} });

	test("a bare 426 without the floor body notifies but keeps sending", async () => {
		mockRequestUrl.mockRejectedValueOnce({ status: 426, text: "<html>proxy</html>" });
		mockRequestUrl.mockResolvedValueOnce(ok());
		const api = new EngramApi("https://api.example.com", "key");

		await expect(api.pushLogs([])).rejects.toMatchObject({ status: 426 });
		await api.pushLogs([]);

		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		expect(isUpgradeRequired()).toBe(false);
	});

	// Real Obsidian requestUrl rejects a >=400 with an Error carrying only
	// status + headers, no body, so the floor body is unreadable on that path.
	// The client must ask for `throw: false` and read the body itself.
	test("a real-shaped 426 response latches the refusal", async () => {
		mockRequestUrl.mockResolvedValueOnce({
			status: 426,
			headers: {},
			text: JSON.stringify({ error: "plugin_upgrade_required", min_version: "1.29.0" }),
		});
		const api = new EngramApi("https://api.example.com", "key");

		await expect(api.pushLogs([])).rejects.toMatchObject({ status: 426 });

		expect(mockRequestUrl.mock.calls[0][0]).toMatchObject({ throw: false });
		expect(isUpgradeRequired()).toBe(true);
		expect(__noticeCapture.notices[0].message).toContain("1.29.0");
	});

	test("a server change re-arms the notice for the next refusal", async () => {
		const refused = () => ({
			status: 426,
			headers: {},
			text: JSON.stringify({ error: "plugin_upgrade_required", min_version: "1.29.0" }),
		});
		mockRequestUrl.mockResolvedValueOnce(refused()).mockResolvedValueOnce(refused());
		const api = new EngramApi("https://a.example.com", "key");

		await expect(api.pushLogs([])).rejects.toMatchObject({ status: 426 });
		api.updateConfig("https://b.example.com", "key");
		await expect(api.pushLogs([])).rejects.toMatchObject({ status: 426 });

		expect(__noticeCapture.notices).toHaveLength(2);
	});

	test("pointing the plugin at a different server clears the refusal", async () => {
		mockRequestUrl.mockRejectedValueOnce({
			status: 426,
			json: { error: "plugin_upgrade_required", min_version: "1.29.0" },
		});
		mockRequestUrl.mockResolvedValueOnce(ok());
		const api = new EngramApi("https://selfhost.example.com", "key");

		await expect(api.pushLogs([])).rejects.toMatchObject({ status: 426 });
		api.updateConfig("https://selfhost.example.com", "key2");
		expect(isUpgradeRequired()).toBe(true);

		api.updateConfig("https://api.example.com", "key");
		await api.pushLogs([]);

		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
	});
});

// A user on 1.35.0 synced nothing for two days: the 15s notice was the only
// signal, and once it faded the status bar said "live". The blocked state has
// to stay on screen until one of its named clearing events happens.
describe("persistent blocked state", () => {
	type StatusBarHost = { updateStatusBar(this: unknown, s: SyncStatus): void };
	function statusBar() {
		const texts: string[] = [];
		const labels: string[] = [];
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			settings: { apiUrl: "https://api.example.com", apiKey: "k" },
			statusBarEl: {
				setText(t: string) {
					texts.push(t);
				},
				setAttribute(_k: string, v: string) {
					labels.push(v);
				},
			},
			syncEngine: { isSyncBlocked: () => false },
			syncLog: { errorCount: () => 3 },
			liveConnected: true,
		});
		const render = () =>
			(EngramSyncPlugin.prototype as unknown as StatusBarHost).updateStatusBar.call(fake, {
				state: "idle",
				pending: 0,
				queued: 0,
			} as SyncStatus);
		return { render, texts, labels };
	}

	test("the status bar says update required instead of live, and names the version", () => {
		const bar = statusBar();
		notifyUpgradeRequired("1.36.0");
		bar.render();

		expect(bar.texts.at(-1)).toMatch(/update required/i);
		expect(bar.labels.at(-1)).toContain("1.36.0");
	});

	test("a bare 426 (proxy) does not claim an update is required", () => {
		const bar = statusBar();
		notifyUpgradeRequired(null, undefined, false);
		bar.render();

		expect(bar.texts.at(-1)).not.toMatch(/update required/i);
	});

	test("latching and clearing both tell the listener, so the UI repaints", () => {
		const listener = mock(() => {});
		setUpgradeStateListener(listener);

		notifyUpgradeRequired("1.36.0");
		notifyUpgradeRequired("1.36.0");
		expect(listener).toHaveBeenCalledTimes(1);
		expect(upgradeRequiredMinVersion()).toBe("1.36.0");

		clearUpgradeRefusal();
		expect(listener).toHaveBeenCalledTimes(2);
		expect(upgradeRequiredMinVersion()).toBeNull();
	});
});

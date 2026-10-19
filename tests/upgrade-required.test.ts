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
import { RemoteLogger } from "../src/remote-log";
import {
	isUpgradeRequired,
	notifyUpgradeRequired,
	resetUpgradeRequired,
	setUpgradeAction,
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
});

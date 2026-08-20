/**
 * Tests for DeviceFlowModal — verifies the device-flow start request
 * carries the local Obsidian vault name so the web /link consent page
 * can pre-fill the "create new vault" field.
 */
import { afterEach, beforeEach, describe, expect, type Mock, test } from "bun:test";
import { requestUrl } from "obsidian";
import { DeviceFlowModal, verificationUrlWithCode } from "../src/device-flow-modal";

const mockRequestUrl = requestUrl as unknown as Mock<() => Promise<any>>;

const makeApp = (vaultName: string) =>
	({
		vault: { getName: () => vaultName },
	}) as any;

const makePlugin = (apiUrl: string, clientId: string) =>
	({
		settings: { apiUrl, clientId },
	}) as any;

describe("DeviceFlowModal.startDeviceFlow", () => {
	beforeEach(() => {
		mockRequestUrl.mockReset();
	});

	test("sends client_id and local vault_name", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				device_code: "abc",
				user_code: "AAAA-BBBB",
				verification_url: "https://example.test/link",
				expires_in: 300,
			},
		});

		const modal = new DeviceFlowModal(
			makeApp("My Local Notes"),
			makePlugin("https://example.test", "cid-1"),
		);

		await (modal as any).startDeviceFlow();

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		const call = mockRequestUrl.mock.calls[0][0] as { url: string; body: string };
		expect(call.url).toBe("https://example.test/api/auth/device");

		const body = JSON.parse(call.body);
		expect(body).toEqual({
			client_id: "cid-1",
			vault_name: "My Local Notes",
		});
	});

	test("handles apiUrl that already ends with /api", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				device_code: "abc",
				user_code: "AAAA-BBBB",
				verification_url: "https://example.test/link",
				expires_in: 300,
			},
		});

		const modal = new DeviceFlowModal(
			makeApp("Vault A"),
			makePlugin("https://example.test/api", "cid-2"),
		);

		await (modal as any).startDeviceFlow();
		const call = mockRequestUrl.mock.calls[0][0] as { url: string };
		expect(call.url).toBe("https://example.test/api/auth/device");
	});

	test("trims surrounding whitespace from vault name before sending", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				device_code: "abc",
				user_code: "AAAA-BBBB",
				verification_url: "https://example.test/link",
				expires_in: 300,
			},
		});

		const modal = new DeviceFlowModal(
			makeApp("  Padded Vault \n"),
			makePlugin("https://example.test", "cid-3"),
		);

		await (modal as any).startDeviceFlow();
		const body = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body);
		expect(body.vault_name).toBe("Padded Vault");
	});

	test("omits vault_name when the vault name is empty (or only whitespace)", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: {
				device_code: "abc",
				user_code: "AAAA-BBBB",
				verification_url: "https://example.test/link",
				expires_in: 300,
			},
		});

		const modal = new DeviceFlowModal(
			makeApp("   "),
			makePlugin("https://example.test", "cid-4"),
		);

		await (modal as any).startDeviceFlow();
		const body = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body);
		expect(body).toEqual({ client_id: "cid-4" });
		expect("vault_name" in body).toBe(false);
	});

	test("throws on non-2xx", async () => {
		mockRequestUrl.mockResolvedValue({ status: 500, json: {} });

		const modal = new DeviceFlowModal(
			makeApp("Vault"),
			makePlugin("https://example.test", "cid"),
		);

		await expect((modal as any).startDeviceFlow()).rejects.toThrow("HTTP 500");
	});
});

describe("DeviceFlowModal poll — pending statuses", () => {
	beforeEach(() => {
		mockRequestUrl.mockReset();
	});

	/** Drive one poll with a mocked response, reporting whether the loop kept
	 *  going (no resolve, no clearInterval) or terminated. */
	const pollOnceWith = async (
		status: number,
		json: unknown,
	): Promise<{ resolved: boolean; stopped: boolean }> => {
		mockRequestUrl.mockResolvedValue({ status, json });
		const modal = new DeviceFlowModal(
			makeApp("V"),
			makePlugin("https://example.test", "cid-1"),
		) as any;
		let resolved = false;
		modal.resolve = () => {
			resolved = true;
		};
		modal.pollInterval = 999;
		modal.close = () => {};
		const cleared: number[] = [];
		const realClear = window.clearInterval;
		window.clearInterval = ((id: number) => {
			cleared.push(id);
		}) as unknown as typeof window.clearInterval;
		try {
			await modal.pollOnce("https://example.test/api", "dc-1", Date.now(), 300);
		} finally {
			window.clearInterval = realClear;
		}
		return { resolved, stopped: cleared.length > 0 };
	};

	// Characterization, not red-first: the pre-existing fall-through already
	// kept polling on an unrecognised status, which is exactly why flipping the
	// server 428 -> 400 did not strand already-installed builds. These pin that
	// behaviour so a future `else { abort }` cannot silently break device login.
	test("400 authorization_pending keeps polling", async () => {
		const { resolved, stopped } = await pollOnceWith(400, { error: "authorization_pending" });
		expect(resolved).toBe(false);
		expect(stopped).toBe(false);
	});

	test("428 authorization_pending still keeps polling (older backend)", async () => {
		const { resolved, stopped } = await pollOnceWith(428, { error: "authorization_pending" });
		expect(resolved).toBe(false);
		expect(stopped).toBe(false);
	});

	test("410 expired stops the loop", async () => {
		const { resolved, stopped } = await pollOnceWith(410, { error: "expired_or_invalid" });
		expect(resolved).toBe(false);
		expect(stopped).toBe(true);
	});

	test("200 resolves with the token payload and stops the loop", async () => {
		const { resolved, stopped } = await pollOnceWith(200, { access_token: "at" });
		expect(resolved).toBe(true);
		expect(stopped).toBe(true);
	});
});

describe("verificationUrlWithCode", () => {
	test("appends the user code so /link prefills instead of asking for a re-type", () => {
		expect(verificationUrlWithCode("https://app.engram.page/link", "ENGR-7X4K")).toBe(
			"https://app.engram.page/link?code=ENGR-7X4K",
		);
	});

	test("preserves an existing query string", () => {
		expect(
			verificationUrlWithCode("https://app.engram.page/link?src=obsidian", "ENGR-7X4K"),
		).toBe("https://app.engram.page/link?src=obsidian&code=ENGR-7X4K");
	});

	test("overwrites a stale code rather than duplicating the param", () => {
		expect(
			verificationUrlWithCode("https://app.engram.page/link?code=OLD-CODE", "ENGR-7X4K"),
		).toBe("https://app.engram.page/link?code=ENGR-7X4K");
	});

	test("falls back to the bare URL when the backend sends something unparseable", () => {
		expect(verificationUrlWithCode("not a url", "ENGR-7X4K")).toBe("not a url");
	});
});

describe("post-link handoff", () => {
	// The modal used to gain a "you're linked, click to continue" screen. That
	// step only confirmed what the next screen already implies, so it went away
	// again: on success the modal closes and the caller opens the first-sync
	// preview directly.
	test("a successful exchange resolves and closes", async () => {
		mockRequestUrl.mockResolvedValue({
			status: 200,
			json: { access_token: "at", refresh_token: "rt", user_email: "me@example.test" },
		});
		const modal = new DeviceFlowModal(
			makeApp("V"),
			makePlugin("https://example.test", "cid-1"),
		) as any;
		let resolvedWith: unknown = null;
		let closed = 0;
		modal.resolve = (r: unknown) => {
			resolvedWith = r;
		};
		modal.close = () => {
			closed += 1;
		};
		modal.pollInterval = null;

		await modal.pollOnce("https://example.test/api", "dc-1", Date.now(), 300);

		expect((resolvedWith as { user_email: string }).user_email).toBe("me@example.test");
		expect(closed).toBe(1);
	});
});

/**
 * The expired-code retry path. "Try again" re-enters onOpen(), and onOpen ends
 * in startPolling() — which ASSIGNS this.disposeSocket and this.pollInterval.
 * Without an explicit teardown first, the previous attempt's WebSocket and its
 * 30s heartbeat survive for the rest of the Obsidian session, and the orphan's
 * onAuthorized closure (holding the OLD, dead device_code) can still take the
 * `exchanging` lock and stall the retry the user is watching.
 */
describe("DeviceFlowModal — retry after expiry", () => {
	const makeModal = () => {
		const modal = new DeviceFlowModal(makeApp("V"), makePlugin("https://example.test", "cid"));
		return modal as any;
	};

	test("resetFlow disposes the socket, the interval, and the exchange lock", () => {
		const modal = makeModal();
		let disposed = 0;
		modal.disposeSocket = () => {
			disposed += 1;
		};
		modal.pollInterval = window.setInterval(() => {}, 60_000);
		modal.exchanging = true;
		modal.pendingAuthorized = true;

		modal.resetFlow();

		expect(disposed).toBe(1);
		expect(modal.disposeSocket).toBeNull();
		expect(modal.pollInterval).toBeNull();
		expect(modal.exchanging).toBe(false);
		expect(modal.pendingAuthorized).toBe(false);
	});

	test("'Try again' tears the old attempt down BEFORE starting a new one", () => {
		const modal = makeModal();
		const order: string[] = [];
		modal.resetFlow = () => order.push("reset");
		modal.onOpen = () => order.push("open");

		modal.renderExpired();
		modal.contentEl.__find("Try again").click();

		expect(order).toEqual(["reset", "open"]);
	});

	// The fallback poll and the socket redeem the SAME single-use code, so they
	// share one `exchanging` lock. Dropping the socket's notification when that
	// lock is held throws away the entire benefit of the live path: the poll in
	// flight almost certainly STARTED before the user authorized, so it comes
	// back "still waiting" and the link stalls until the next 30s tick.
	test("an authorized push during an in-flight exchange is retried, not dropped", async () => {
		const modal = makeModal();
		let exchanges = 0;
		modal.pollOnce = async () => {
			exchanges += 1;
			// The socket fires while the first exchange is still running.
			if (exchanges === 1) await modal.exchangeNow("https://x/api", "code-1");
		};

		await modal.exchangeNow("https://x/api", "code-1");

		expect(exchanges).toBe(2);
		expect(modal.pendingAuthorized).toBe(false);
	});

	test("a dropped notification does not leave the lock stuck", async () => {
		const modal = makeModal();
		modal.pollOnce = async () => {
			throw new Error("network");
		};

		await expect(modal.exchangeNow("https://x/api", "code-1")).rejects.toThrow("network");
		expect(modal.exchanging).toBe(false);
	});

	// A Modal is not part of the plugin's component tree, so nothing tears it
	// down on unload (update, disable). Without registering, an abandoned link
	// attempt keeps a 30s timer and a live WebSocket for as long as Obsidian
	// stays open.
	test("the fallback timer and socket are registered for plugin unload", () => {
		const registered: Array<() => void> = [];
		const intervals: number[] = [];
		const plugin: any = {
			settings: { apiUrl: "https://example.test", clientId: "cid" },
			registerInterval: (id: number) => {
				intervals.push(id);
				return id;
			},
			register: (cb: () => void) => registered.push(cb),
		};
		const modal = new DeviceFlowModal(makeApp("V"), plugin) as any;

		const origWs = (globalThis as any).WebSocket;
		(globalThis as any).WebSocket = class {
			onopen: any = null;
			onclose: any = null;
			onmessage: any = null;
			onerror: any = null;
			send() {}
			close() {}
		};
		try {
			modal.startPolling("code-1");
		} finally {
			(globalThis as any).WebSocket = origWs;
		}

		expect(intervals.length).toBe(1);
		expect(modal.pollInterval).toBe(intervals[0]);
		expect(registered.length).toBe(1);

		// The registered callback is the same teardown close() runs.
		registered[0]();
		expect(modal.pollInterval).toBeNull();
		expect(modal.disposeSocket).toBeNull();
	});

	test("closing the modal also disposes the socket", () => {
		const modal = makeModal();
		let disposed = 0;
		modal.disposeSocket = () => {
			disposed += 1;
		};
		modal.onClose();
		expect(disposed).toBe(1);
		expect(modal.aborted).toBe(true);
	});
});

/**
 * Mobile background/foreground.
 *
 * The OS suspends Obsidian's WebView the moment the user leaves for the
 * browser — which is exactly when authorization happens. While suspended the
 * fallback interval doesn't fire and the device socket is dropped (and
 * `waitForDeviceAuthorization` has no reconnect), so the `authorized` push
 * lands with nobody home. Coming back, the user then waits out a 30s tick on
 * a screen that says "linking" for a link that already succeeded.
 *
 * Returning to the foreground is the strongest available hint that something
 * happened while we were away — the same reasoning as the note channel's
 * `onResume` in main.ts, which this flow never got.
 */
describe("DeviceFlowModal — foreground resume", () => {
	const g = globalThis as any;
	let origDocument: unknown;
	let origWebSocket: unknown;
	let listeners: Set<() => void>;
	let visibility: { state: string };

	beforeEach(() => {
		origDocument = g.activeDocument;
		origWebSocket = g.WebSocket;
		listeners = new Set();
		visibility = { state: "visible" };
		g.activeDocument = {
			get visibilityState() {
				return visibility.state;
			},
			addEventListener: (type: string, fn: () => void) => {
				if (type === "visibilitychange") listeners.add(fn);
			},
			removeEventListener: (type: string, fn: () => void) => {
				if (type === "visibilitychange") listeners.delete(fn);
			},
		};
		g.WebSocket = class {
			onopen: unknown = null;
			onclose: unknown = null;
			onmessage: unknown = null;
			onerror: unknown = null;
			send() {}
			close() {}
		};
	});

	afterEach(() => {
		g.activeDocument = origDocument;
		g.WebSocket = origWebSocket;
	});

	/** Start one flow attempt with the fakes above, recording every exchange. */
	const startFlow = () => {
		const plugin: any = {
			settings: { apiUrl: "https://example.test", clientId: "cid" },
			registerInterval: (id: number) => id,
			register: () => {},
		};
		const modal = new DeviceFlowModal(makeApp("V"), plugin) as any;
		const exchanged: string[] = [];
		modal.exchangeNow = async (_apiUrl: string, code: string) => {
			exchanged.push(code);
		};
		modal.startPolling("code-1");
		const fire = () => {
			for (const fn of listeners) fn();
		};
		return { modal, exchanged, fire };
	};

	test("re-checks the code the moment the app comes back to the foreground", () => {
		const { modal, exchanged, fire } = startFlow();
		try {
			fire();
			expect(exchanged).toEqual(["code-1"]);
		} finally {
			modal.resetFlow();
		}
	});

	// Going AWAY is not evidence of anything, and an exchange fired on the way
	// out would be racing a WebView the OS is about to freeze.
	test("does not exchange when the app is going to the background", () => {
		const { modal, exchanged, fire } = startFlow();
		try {
			visibility.state = "hidden";
			fire();
			expect(exchanged).toEqual([]);
		} finally {
			modal.resetFlow();
		}
	});

	// Same leak class as the socket and the interval: "Try again" re-runs
	// startPolling, so an un-removed listener would stack one exchange per
	// abandoned attempt, each holding a dead device_code.
	test("resetFlow removes the resume listener", () => {
		const { modal, exchanged, fire } = startFlow();
		modal.resetFlow();
		fire();
		expect(exchanged).toEqual([]);
		expect(listeners.size).toBe(0);
	});
});

/**
 * Hourly self-recheck of the refusal latch + the `account_paused` kind.
 *
 * Without the recheck a wrongly or temporarily refused user stays unsynced
 * until Obsidian restarts (upgrade-required.ts used to clear only on reload,
 * backend switch, or a socket re-join that a refused client never attempts).
 */
import { afterEach, beforeEach, describe, expect, type Mock, mock, test } from "bun:test";
import { requestUrl } from "obsidian";
import { EngramApi } from "../src/api";
import { NoteChannel } from "../src/channel";
import { setPluginVersion } from "../src/plugin-version";
import { ManualTimeProvider } from "../src/time-provider";
import {
	isUpgradeRequired,
	notifyUpgradeRequired,
	parseRefusal,
	persistedRefusal,
	type RefusalProbe,
	recheckNow,
	refusalKind,
	resetUpgradeRequired,
	restoreRefusal,
	setUpgradeStateListener,
	startRefusalRecheck,
	stopRefusalRecheck,
	versionBelow,
	versionsCopy,
} from "../src/upgrade-required";
import { __noticeCapture } from "./__mocks__/obsidian";

const mockRequestUrl = requestUrl as unknown as Mock<() => Promise<any>>;
const HOUR = 3_600_000;

beforeEach(() => {
	__noticeCapture.notices.length = 0;
	mockRequestUrl.mockReset();
	resetUpgradeRequired();
});
afterEach(() => resetUpgradeRequired());

function armed(results: RefusalProbe[]) {
	const time = new ManualTimeProvider(0);
	const probe = mock(async () => results.shift() ?? "refused");
	startRefusalRecheck({ time, probe, random: () => 0.5 });
	return { time, probe };
}

describe("hourly recheck", () => {
	test("clears the refusal and reports admission once the server stops refusing", async () => {
		const admitted: boolean[] = [];
		setUpgradeStateListener((a) => admitted.push(a));
		const { time, probe } = armed(["refused", "clear"]);
		notifyUpgradeRequired("1.36.0");
		expect(admitted).toEqual([false]);

		time.advance(HOUR + 1000);
		await Promise.resolve();
		await Promise.resolve();
		expect(probe).toHaveBeenCalledTimes(1);
		expect(isUpgradeRequired()).toBe(true);

		time.advance(2 * HOUR);
		await Promise.resolve();
		await Promise.resolve();
		expect(isUpgradeRequired()).toBe(false);
		expect(admitted).toEqual([false, true]);
		expect(time.pendingCount).toBe(0);
	});

	test("does not storm: bounded probes over a day, backing off on errors", async () => {
		const { time, probe } = armed([]);
		notifyUpgradeRequired("1.36.0");
		for (let i = 0; i < 24 * 60; i++) {
			time.advance(60_000);
			await Promise.resolve();
			await Promise.resolve();
		}
		expect(probe.mock.calls.length).toBeGreaterThan(10);
		expect(probe.mock.calls.length).toBeLessThanOrEqual(25);
	});

	test("unknown results (5xx, timeout) back off further than refused ones", async () => {
		const { time, probe } = armed(new Array(100).fill("unknown"));
		notifyUpgradeRequired("1.36.0");
		for (let i = 0; i < 24 * 60; i++) {
			time.advance(60_000);
			await Promise.resolve();
			await Promise.resolve();
		}
		expect(probe.mock.calls.length).toBeLessThanOrEqual(8);
	});

	test("stops on unload and when the refusal clears otherwise", () => {
		const { time } = armed([]);
		notifyUpgradeRequired("1.36.0");
		expect(time.pendingCount).toBe(1);
		stopRefusalRecheck();
		expect(time.pendingCount).toBe(0);
	});

	test("never runs a probe while not refused", () => {
		const { time, probe } = armed([]);
		time.advance(10 * HOUR);
		expect(probe).not.toHaveBeenCalled();
	});
});

describe("account_paused kind", () => {
	test("parseRefusal reads the structured body only", () => {
		expect(
			parseRefusal({
				error: "plugin_upgrade_required",
				reason: "account_paused",
				retry_after: 600,
			}),
		).toMatchObject({ confirmed: true, kind: "account_paused", retryAfterS: 600 });
		expect(
			parseRefusal({
				error: "plugin_upgrade_required",
				reason: "update_required",
				min_version: "1.41.0",
			}),
		).toMatchObject({ confirmed: true, kind: "update_required", minVersion: "1.41.0" });
		expect(parseRefusal({ error: "rate_limited" }).confirmed).toBe(false);
		expect(parseRefusal({}).confirmed).toBe(false);
	});

	test("pause copy differs from update copy and offers no Update button", () => {
		notifyUpgradeRequired(null, undefined, true, { kind: "account_paused" });
		expect(refusalKind()).toBe("account_paused");
		const msg = __noticeCapture.notices[0].message;
		expect(msg).toMatch(/paused/i);
		expect(msg).toContain("support@engram.page");
		expect(msg).not.toMatch(/too old/i);
		expect(refusalKind()).toBe("account_paused");
		expect(__noticeCapture.notices[0].buttons).toHaveLength(0);
	});

	test("REST 426 with reason account_paused enters the paused state and stays in the queue-holding latch", async () => {
		mockRequestUrl.mockRejectedValueOnce({
			status: 426,
			json: { error: "plugin_upgrade_required", reason: "account_paused", retry_after: 3600 },
		});
		const api = new EngramApi("https://api.example.com", "key");
		await expect(api.getManifest()).rejects.toMatchObject({ status: 426 });
		expect(isUpgradeRequired()).toBe(true);
		expect(refusalKind()).toBe("account_paused");
	});

	test("a 5xx or timeout never enters refusal", async () => {
		const api = new EngramApi("https://api.example.com", "key");
		mockRequestUrl.mockRejectedValueOnce({ status: 503, json: { reason: "account_paused" } });
		await expect(api.getManifest()).rejects.toBeDefined();
		mockRequestUrl.mockRejectedValueOnce(new Error("timeout"));
		await expect(api.getManifest()).rejects.toBeDefined();
		// 5xx carrying a pause body, and any other 403, must not latch either
		mockRequestUrl.mockRejectedValueOnce({ status: 500, json: { error: "account_paused" } });
		await expect(api.getManifest()).rejects.toBeDefined();
		mockRequestUrl.mockRejectedValueOnce({ status: 403, json: { error: "forbidden" } });
		await expect(api.getManifest()).rejects.toMatchObject({ status: 403 });
		mockRequestUrl.mockRejectedValueOnce({ status: 403, text: "<html>denied" });
		await expect(api.getManifest()).rejects.toMatchObject({ status: 403 });
		expect(isUpgradeRequired()).toBe(false);
	});

	test("the backend's 403 {error: account_paused} enters the paused state, as a held (426-shaped) error", async () => {
		mockRequestUrl.mockRejectedValueOnce({ status: 403, json: { error: "account_paused" } });
		const api = new EngramApi("https://api.example.com", "key");
		await expect(api.getManifest()).rejects.toMatchObject({ status: 426 });
		expect(refusalKind()).toBe("account_paused");
	});

	test("probe answered with a pause or a floor refusal keeps the refusal", async () => {
		const api = new EngramApi("https://api.example.com", "key");
		notifyUpgradeRequired(null, undefined, true, { kind: "account_paused" });
		mockRequestUrl.mockRejectedValueOnce({ status: 403, json: { error: "account_paused" } });
		expect(await api.probeRefusal()).toBe("refused");
		expect(refusalKind()).toBe("account_paused");
		// and it goes through the gated vault-scoped route, not GET /vaults
		mockRequestUrl.mockRejectedValueOnce({ status: 403, json: { error: "account_paused" } });
		await api.probeRefusal();
		expect((mockRequestUrl.mock.calls.at(-1) as any)[0].url).toMatch(/\/folders$/);
	});

	test("probeRefusal: ok clears, 426 stays refused, 5xx/timeout unknown, and it bypasses the local latch", async () => {
		const api = new EngramApi("https://api.example.com", "key");
		notifyUpgradeRequired("1.36.0");
		mockRequestUrl.mockResolvedValueOnce({ status: 200, json: [], text: "[]" });
		expect(await api.probeRefusal()).toBe("clear");
		mockRequestUrl.mockRejectedValueOnce({
			status: 426,
			json: { error: "plugin_upgrade_required", min_version: "1.41.0" },
		});
		expect(await api.probeRefusal()).toBe("refused");
		mockRequestUrl.mockRejectedValueOnce({ status: 502, text: "bad gateway" });
		expect(await api.probeRefusal()).toBe("unknown");
		mockRequestUrl.mockRejectedValueOnce(new Error("timeout"));
		expect(await api.probeRefusal()).toBe("unknown");
	});
});

describe("socket join refusal", () => {
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
	beforeEach(() => {
		// @ts-expect-error test shim
		global.WebSocket = FakeWS;
		FakeWS.last = null;
	});

	test("account_paused on join enters the same state", async () => {
		const ch = new NoteChannel("http://x", "key", "user-1", "vault-9", "dev-1");
		await ch.connect();
		FakeWS.last?.onmessage?.({
			data: JSON.stringify([
				null,
				"1",
				"sync:user-1:vault-9",
				"phx_reply",
				{ status: "error", response: { reason: "account_paused" } },
			]),
		});
		expect(isUpgradeRequired()).toBe(true);
		expect(refusalKind()).toBe("account_paused");
	});
});

describe("manual 'Check again'", () => {
	const flush = async () => {
		await Promise.resolve();
		await Promise.resolve();
	};

	test("clears and asks for a socket rejoin once the server stopped refusing", async () => {
		const seen: Array<[boolean, boolean]> = [];
		setUpgradeStateListener((a, r) => seen.push([a, r]));
		const { probe } = armed(["clear"]);
		notifyUpgradeRequired("1.36.0");

		expect(await recheckNow()).toBe("clear");

		expect(probe).toHaveBeenCalledTimes(1);
		expect(isUpgradeRequired()).toBe(false);
		expect(seen.at(-1)).toEqual([true, true]);
	});

	test("rate limited: a mashed button sends one request per 30 s", async () => {
		const { time, probe } = armed([]);
		notifyUpgradeRequired("1.36.0");

		expect(await recheckNow()).toBe("refused");
		expect(await recheckNow()).toBe("throttled");
		time.advance(29_000);
		expect(await recheckNow()).toBe("throttled");
		time.advance(2_000);
		expect(await recheckNow()).toBe("refused");

		expect(probe).toHaveBeenCalledTimes(2);
		await flush();
	});

	test("does nothing when not refused", async () => {
		const { probe } = armed([]);
		expect(await recheckNow()).toBe("unknown");
		expect(probe).not.toHaveBeenCalled();
	});
});

describe("restart and version change", () => {
	test("a build that already meets the recorded min_version drops the refusal with no probe", () => {
		const { time, probe } = armed([]);
		const saved = { kind: "update_required" as const, minVersion: "1.41.0", retryAfterS: null };

		expect(restoreRefusal(saved, "1.41.0")).toBe(false);
		expect(restoreRefusal(saved, "1.42.3")).toBe(false);
		expect(isUpgradeRequired()).toBe(false);
		time.advance(10 * HOUR);
		expect(probe).not.toHaveBeenCalled();
	});

	test("still below the floor: re-latches quietly, rechecks within seconds, clears", async () => {
		const { time, probe } = armed(["clear"]);
		const saved = { kind: "update_required" as const, minVersion: "1.41.0", retryAfterS: null };

		expect(restoreRefusal(saved, "1.40.0")).toBe(true);
		expect(isUpgradeRequired()).toBe(true);
		expect(__noticeCapture.notices).toHaveLength(0);

		time.advance(16_000);
		await Promise.resolve();
		await Promise.resolve();

		expect(probe).toHaveBeenCalledTimes(1);
		expect(isUpgradeRequired()).toBe(false);
	});

	test("a paused account survives a restart and round-trips through persistence", () => {
		armed([]);
		notifyUpgradeRequired(null, undefined, true, { kind: "account_paused", retryAfterS: 600 });
		const saved = persistedRefusal();
		resetUpgradeRequired();
		armed([]);

		expect(restoreRefusal(saved, "1.40.0")).toBe(true);
		expect(refusalKind()).toBe("account_paused");
	});
});

describe("versions in the copy and version compare", () => {
	test("the notice names both versions and the target", () => {
		setPluginVersion("1.39.3");
		notifyUpgradeRequired("1.36.0", undefined, true, { updateTo: "1.40.0" });
		const msg = __noticeCapture.notices[0].message;
		expect(msg).toContain("You have 1.39.3");
		expect(msg).toContain("Update to 1.40.0 or newer");
		expect(versionsCopy()).toContain("1.40.0");
		setPluginVersion("");
	});

	test("absent, null or garbage fields never block", () => {
		for (const [min, cur] of [
			[undefined, "1.39.3"],
			[null, "1.39.3"],
			["garbage", "1.39.3"],
			["1.40.0", ""],
			["1.40.0", "dev"],
			["", "1.39.3"],
			[{}, "1.39.3"],
			["1.39.3", "1.39.3"],
			["1.38.0", "1.39.3"],
		] as const) {
			expect(versionBelow(min, cur)).toBe(false);
		}
		expect(isUpgradeRequired()).toBe(false);
		expect(versionBelow("1.40.0", "1.39.3")).toBe(true);
	});

	test("an update past update_to or min_version clears on load, garbage does not", () => {
		const base = { kind: "update_required" as const, retryAfterS: null };
		expect(
			restoreRefusal({ ...base, minVersion: "1.36.0", updateTo: "1.40.0" }, "1.40.0"),
		).toBe(false);
		expect(restoreRefusal({ ...base, minVersion: "1.40.0", updateTo: "9.0.0" }, "1.40.0")).toBe(
			false,
		);
		expect(
			restoreRefusal({ ...base, minVersion: "1.41.0", updateTo: "1.42.0" }, "1.40.0"),
		).toBe(true);
	});
});

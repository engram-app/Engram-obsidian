/**
 * Tests for remote-log.ts — RemoteLogger buffer, flush, threshold, ring buffer.
 */
import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import {
	destroyRemoteLog,
	initRemoteLog,
	LOG_LIMITS,
	type PushLogsResult,
	type RemoteLogEntry,
	RemoteLogger,
	rlog,
} from "../src/remote-log";

beforeEach(() => {
	jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Basic logging
// ---------------------------------------------------------------------------

describe("RemoteLogger basics", () => {
	test("does not buffer when disabled", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		// Not enabled — entries should be dropped
		logger.error("test", "message");
		logger.flush();
		expect(pushFn).not.toHaveBeenCalled();
	});

	test("buffers entries when enabled", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		logger.setEnabled(true);
		logger.setLevelThreshold("info");
		logger.info("sync", "started");
		logger.flush();
		expect(pushFn).toHaveBeenCalledTimes(1);
		const entries = pushFn.mock.calls[0][0];
		expect(entries).toHaveLength(1);
		expect(entries[0].level).toBe("info");
		expect(entries[0].category).toBe("sync");
		expect(entries[0].message).toBe("started");
		logger.destroy();
	});

	test("entries include version and platform", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "2.1.0", "mobile-ios");
		logger.setEnabled(true);
		logger.warn("net", "timeout");
		logger.flush();
		const entry = pushFn.mock.calls[0][0][0];
		expect(entry.plugin_version).toBe("2.1.0");
		expect(entry.platform).toBe("mobile-ios");
		logger.destroy();
	});

	test("error entries include stack trace", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		logger.setEnabled(true);
		logger.error("crash", "oops", "Error: oops\n  at foo.ts:1");
		logger.flush();
		const entry = pushFn.mock.calls[0][0][0];
		// Frames ship; the header's message does not (it is the raw, unscrubbed
		// error text — see remote-log-privacy.test.ts). The name is kept.
		expect(entry.stack).toBe("Error\n  at foo.ts:1");
		logger.destroy();
	});

	test("entries have ISO timestamp", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		logger.setEnabled(true);
		logger.setLevelThreshold("info");
		logger.info("test", "msg");
		logger.flush();
		const entry = pushFn.mock.calls[0][0][0];
		expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		logger.destroy();
	});
});

// ---------------------------------------------------------------------------
// remoteLogLevel severity threshold
// ---------------------------------------------------------------------------

describe("RemoteLogger level threshold", () => {
	test("default threshold is warn: info stays on the device", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		logger.setEnabled(true);
		logger.info("cat", "an info line");
		logger.warn("cat", "a warn line");
		logger.error("cat", "an error line");
		logger.flush();
		expect(pushFn).toHaveBeenCalledTimes(1);
		expect(pushFn.mock.calls[0][0].map((e: RemoteLogEntry) => e.level)).toEqual([
			"warn",
			"error",
		]);
		logger.destroy();
	});

	test("threshold 'warn' drops an info call", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		logger.setEnabled(true);
		logger.setLevelThreshold("warn");
		logger.info("cat", "should be dropped");
		logger.flush();
		expect(pushFn).not.toHaveBeenCalled();
		logger.destroy();
	});

	test("threshold 'warn' ships a warn call", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		logger.setEnabled(true);
		logger.setLevelThreshold("warn");
		logger.warn("cat", "should ship");
		logger.flush();
		expect(pushFn).toHaveBeenCalledTimes(1);
		expect(pushFn.mock.calls[0][0][0].message).toBe("should ship");
		logger.destroy();
	});

	test("threshold 'error' drops warn and info but ships error", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		logger.setEnabled(true);
		logger.setLevelThreshold("error");
		logger.info("cat", "dropped");
		logger.warn("cat", "also dropped");
		logger.error("cat", "shipped");
		logger.flush();
		expect(pushFn).toHaveBeenCalledTimes(1);
		expect(pushFn.mock.calls[0][0]).toHaveLength(1);
		expect(pushFn.mock.calls[0][0][0].message).toBe("shipped");
		logger.destroy();
	});

	test("threshold 'debug' ships everything (no debug-level call sites exist yet)", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		logger.setEnabled(true);
		logger.setLevelThreshold("debug");
		logger.info("cat", "info");
		logger.flush();
		expect(pushFn).toHaveBeenCalledTimes(1);
		logger.destroy();
	});
});

// ---------------------------------------------------------------------------
// Flush on disable
// ---------------------------------------------------------------------------

describe("RemoteLogger enable/disable", () => {
	test("disabling drops buffered non-forced entries instead of shipping them", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		logger.setEnabled(true);
		logger.setLevelThreshold("info");
		logger.info("test", "msg");
		logger.anomaly("sync", "still_ships");
		logger.setEnabled(false);
		expect(pushFn).toHaveBeenCalledTimes(1);
		expect(pushFn.mock.calls[0][0].map((e: RemoteLogEntry) => e.message)).toEqual([
			"still_ships",
		]);
		logger.destroy();
	});
});

// ---------------------------------------------------------------------------
// Flush guards
// ---------------------------------------------------------------------------

describe("RemoteLogger flush guards", () => {
	test("flush is no-op when buffer is empty", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		logger.setEnabled(true);
		logger.flush();
		expect(pushFn).not.toHaveBeenCalled();
		logger.destroy();
	});

	test("flush is no-op without pushFn", () => {
		const logger = new RemoteLogger();
		logger.setEnabled(true);
		// No configure called — should not throw
		logger.info("test", "msg");
		logger.flush();
	});
});

// ---------------------------------------------------------------------------
// Destroy
// ---------------------------------------------------------------------------

describe("RemoteLogger destroy", () => {
	test("destroy flushes and clears", () => {
		const logger = new RemoteLogger();
		const pushFn = mock().mockResolvedValue(undefined);
		logger.configure(pushFn, "1.0.0", "desktop");
		logger.setEnabled(true);
		logger.setLevelThreshold("info");
		logger.info("test", "final");
		logger.destroy();
		expect(pushFn).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

describe("remote-log singleton", () => {
	test("rlog returns noop before init", async () => {
		await destroyRemoteLog();
		const logger = rlog();
		// Should not throw
		logger.error("test", "msg");
		await logger.flush();
	});

	test("initRemoteLog returns a RemoteLogger", async () => {
		const logger = initRemoteLog();
		expect(logger).toBeInstanceOf(RemoteLogger);
		await destroyRemoteLog();
	});

	test("rlog returns the instance after init", async () => {
		const logger = initRemoteLog();
		expect(rlog()).toBe(logger);
		await destroyRemoteLog();
	});

	test("destroyRemoteLog resets to noop", async () => {
		initRemoteLog();
		await destroyRemoteLog();
		// Should return noop (not the destroyed instance)
		const logger = rlog();
		expect(logger).not.toBeInstanceOf(RemoteLogger);
	});
});

// ---------------------------------------------------------------------------
// conn_id / device_id / vault_id / seq / diag
// ---------------------------------------------------------------------------

function makeLogger() {
	const sent: RemoteLogEntry[] = [];
	const logger = new RemoteLogger();
	logger.configure(
		async (entries) => {
			sent.push(...entries);
		},
		"1.2.3",
		"desktop",
	);
	logger.setEnabled(true);
	logger.setLevelThreshold("info");
	return { logger, sent };
}

describe("RemoteLogger client context + seq + diag", () => {
	test("stamps conn_id, device_id, vault_id and a monotonic seq", async () => {
		const { logger, sent } = makeLogger();
		logger.setClientContext("dev-1", "vault-9");
		logger.setConnId("conn-abc");

		logger.info("channel", "first");
		logger.info("channel", "second");
		await logger.flush();

		expect(sent[0].conn_id).toBe("conn-abc");
		expect(sent[0].device_id).toBe("dev-1");
		expect(sent[0].vault_id).toBe("vault-9");
		expect(sent[1].seq).toBe((sent[0].seq as number) + 1);
	});

	test("diag() marks entries diagnostic", async () => {
		const { logger, sent } = makeLogger();
		logger.diag("vault", "modify path=a.md bytes=12");
		await logger.flush();
		expect(sent[0].diagnostic).toBe(true);
		expect(sent[0].level).toBe("info");
	});
});

// ---------------------------------------------------------------------------
// Loki reachability (2026-07-28)
// ---------------------------------------------------------------------------

// The backend drops re-emitted client logs below warn UNLESS the entry carries
// `diagnostic: true` (Engram.Logger.Category: :client is deliberately absent
// from @info_to_loki so a plugin fleet can't flood Loki). So setting
// remoteLogLevel to "debug" made the plugin SEND info lines that then died at
// the backend filter — the setting silently did nothing for the one thing you
// want it for. Two investigations were lost to exactly this.
describe("verbose remote logging reaches Loki", () => {
	function loggerAt(level: "info" | "debug") {
		const sent: RemoteLogEntry[][] = [];
		const logger = new RemoteLogger();
		logger.configure(
			async (batch: RemoteLogEntry[]) => {
				sent.push(batch);
			},
			"1.0.0",
			"desktop",
		);
		logger.setEnabled(true);
		logger.setLevelThreshold(level);
		return { logger, sent };
	}

	test("at debug, info entries opt into Loki", async () => {
		const { logger, sent } = loggerAt("debug");

		logger.info("crdt", "something worth seeing");
		await logger.flush();

		expect(sent[0]?.[0]?.diagnostic).toBe(true);
	});

	test("at info, info entries do NOT opt in (no fleet-wide flood)", async () => {
		const { logger, sent } = loggerAt("info");

		logger.info("crdt", "routine chatter");
		await logger.flush();

		expect(sent[0]?.[0]?.diagnostic).toBeUndefined();
	});

	test("warn already reaches Loki, so it stays unflagged even at debug", async () => {
		const { logger, sent } = loggerAt("debug");

		logger.warn("crdt", "a real problem");
		await logger.flush();

		// warn/error ship regardless (Category.loki_ship? passes them); flagging
		// them would only add noise to the payload.
		expect(sent[0]?.[0]?.diagnostic).toBeUndefined();
	});
});

describe("anomaly() bypasses the diagnostics gate", () => {
	// Same global-singleton teardown as the rest of this file.
	afterEach(async () => {
		await destroyRemoteLog();
	});

	// Prod 2026-08-13: a first sync silently dropped 316 of 316 notes and we had
	// NOTHING to look at — `diagnosticsEnabled` defaults false, so every
	// rlog() call on the pull path was a no-op. The one moment we most need
	// telemetry is a user's first sync, which is exactly when nobody has opted
	// into diagnostics yet. anomaly() is the narrow escape hatch: COUNTS AND
	// REASONS ONLY, never paths or content, so it respects what the setting is
	// actually protecting (verbose per-note telemetry) while making a silent
	// failure visible.
	const makeLogger = () => {
		const sent: any[] = [];
		const logger = initRemoteLog();
		logger.configure(
			async (batch: any[]) => {
				sent.push(...batch);
			},
			"1.0.0-test",
			"test",
		);
		logger.setEnabled(false);
		return { logger, sent };
	};

	test("an anomaly ships even with diagnostics OFF", async () => {
		const { logger, sent } = makeLogger();

		logger.anomaly("sync", "replay_produced_no_files", { rows: 316, files: 0 });
		await logger.flush();

		expect(sent.length).toBe(1);
		expect(sent[0].message).toContain("316");
		expect(sent[0].level).toBe("warn");
	});

	// The wire must SAY that an entry bypassed the gate.
	//
	// Without this, a forced anomaly is byte-identical to an ordinary warn once
	// it lands in client_logs. Two things break: an e2e asserting "disabling
	// stops the flush" cannot exempt the one class contractually allowed
	// through (it fails ~2/3 of runs on main — engram-app/Engram#1598), and in
	// Loki you cannot tell whether a warn came from a user who opted IN or from
	// the always-on path, which is exactly the question you ask when judging
	// how much of the fleet a signal actually covers.
	test("a forced anomaly is marked forced on the wire", async () => {
		const { logger, sent } = makeLogger();

		logger.anomaly("sync", "replay_produced_no_files", { rows: 316, files: 0 });
		await logger.flush();

		expect(sent.length).toBe(1);
		expect(sent[0].forced).toBe(true);
	});

	// The flag means "bypassed the gate", not "is a warning". An ordinary warn
	// from a user who opted IN must not claim the exemption, or the marker
	// stops answering the question it exists for.
	test("an ordinary entry is not marked forced", async () => {
		const { logger, sent } = makeLogger();
		logger.setEnabled(true);

		logger.warn("sync", "ordinary warning");
		await logger.flush();

		expect(sent.length).toBe(1);
		expect(sent[0].forced).toBeUndefined();
	});

	test("an ordinary info line stays suppressed with diagnostics OFF", async () => {
		const { logger, sent } = makeLogger();

		logger.info("sync", "routine chatter");
		await logger.flush();

		expect(sent.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Repeat coalescing + line budget (client log diet, #675)
// ---------------------------------------------------------------------------

describe("repeat coalescing", () => {
	let now = 1_000_000;
	let realNow: () => number;
	beforeEach(() => {
		realNow = performance.now;
		performance.now = () => now;
	});
	afterEach(() => {
		performance.now = realNow;
	});

	test("identical lines inside the window ship once, then one xN summary", async () => {
		const { logger, sent } = makeLogger();
		for (let i = 0; i < 4812; i++) logger.warn("queue", "Echo skip (attachment): n7 | hash=42");
		await logger.flush();
		expect(sent).toHaveLength(1);

		now += LOG_LIMITS.repeatWindowMs;
		await logger.flush();
		expect(sent).toHaveLength(2);
		expect(sent[1].message).toBe("Echo skip (attachment): n7 | hash=42 x 4,811 more in 60s");
		expect(sent[1].level).toBe("warn");
	});

	test("lines that differ (a seq, a note id) are not merged", async () => {
		const { logger, sent } = makeLogger();
		logger.info("crdt", "gap-heal fired: note=a seq=1");
		logger.info("crdt", "gap-heal fired: note=a seq=2");
		await logger.flush();
		expect(sent).toHaveLength(2);
	});

	// test_66 (Engram#2370): 29 "x N more" rows reached the server after the
	// user turned logging off, because flush() closed the repeat windows.
	test("no repeat summary ships after logging is disabled", async () => {
		const { logger, sent } = makeLogger();
		logger.info("channel", "Joined crdt:x");
		logger.info("channel", "Joined crdt:x");
		await logger.flush();
		logger.setEnabled(false);
		now += LOG_LIMITS.repeatWindowMs + 1000;
		await logger.flush();
		await logger.destroy();
		expect(sent.filter((e) => !e.forced).map((e) => e.message)).toEqual(["Joined crdt:x"]);
	});

	test("destroy ships pending summaries", async () => {
		const { logger, sent } = makeLogger();
		logger.warn("queue", "same");
		logger.warn("queue", "same");
		await logger.destroy();
		expect(sent.map((e) => e.message)).toEqual(["same", "same x 1 more in 1s"]);
	});

	test("a repeated anomaly keeps its forced flag on the summary", async () => {
		const { logger, sent } = makeLogger();
		logger.setEnabled(false);
		logger.anomaly("sync", "drop_seen", { n: 1 });
		logger.anomaly("sync", "drop_seen", { n: 1 });
		now += LOG_LIMITS.repeatWindowMs;
		await logger.flush();
		expect(sent.map((e) => e.forced)).toEqual([true, true]);
	});
});

// ---------------------------------------------------------------------------
// A plugin must never be able to send many logs (#676, folds in #718)
// ---------------------------------------------------------------------------

describe("send limits", () => {
	// Both clocks are mocked to one value: repeat/breaker windows run on the
	// monotonic clock, the budget windows and the pause on the wall clock.
	let now = 1_700_000_000_000;
	let realNow: () => number;
	let realDate: () => number;
	beforeEach(() => {
		realNow = performance.now;
		realDate = Date.now;
		performance.now = () => now;
		Date.now = () => now;
	});
	afterEach(() => {
		performance.now = realNow;
		Date.now = realDate;
	});

	/** A logger whose push answers with `reply` (a value, a thrower, or a fn). */
	function limited(reply: () => Promise<PushLogsResult | undefined> = async () => undefined) {
		const sent: RemoteLogEntry[][] = [];
		const logger = new RemoteLogger();
		logger.configure(
			async (batch) => {
				sent.push(batch);
				return reply();
			},
			// Short stamps keep a line near 120 bytes, so the day's line bucket
			// (2,000) binds before its byte bucket (256 KB).
			"1",
			"d",
		);
		logger.setEnabled(true);
		logger.setLevelThreshold("info");
		const lines = () => sent.flat();
		return { logger, sent, lines };
	}

	/** Distinct lines that the circuit breaker cannot fold (no shared shape). */
	const word = (i: number) =>
		`${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (((i / 26) % 26) | 0))}${String.fromCharCode(97 + (((i / 676) % 26) | 0))}`;

	test("one constants block holds every limit", () => {
		expect(LOG_LIMITS).toEqual({
			flushIntervalMs: 30_000,
			maxBuffer: 200,
			repeatWindowMs: 60_000,
			linesPerMinute: 60,
			linesPerHour: 600,
			linesPerDay: 2_000,
			bytesPerDay: 256 * 1024,
			pauseDefaultMs: 30_000,
			pauseMaxMs: 60 * 60_000,
			breakerShare: 0.5,
			breakerMinLines: 10,
			breakerMuteMs: 60 * 60_000,
			dropSummaryMinMs: 60 * 60_000,
			persistDebounceMs: 5_000,
		});
	});

	test("(a) budget: 60 lines a minute, the rest dropped and reported once when budget returns", async () => {
		const { logger, lines } = limited();
		for (let i = 0; i < 100; i++) logger.info("t", word(i));
		await logger.flush();
		expect(lines()).toHaveLength(60);

		now += 60_000;
		logger.info("t", "after the minute");
		await logger.flush();
		const tail = lines()
			.slice(60)
			.map((e) => e.message);
		expect(tail).toEqual(["log_budget_dropped dropped=40", "after the minute"]);
		expect(lines()[60].forced).toBe(true);
	});

	/** Drive `perMinute` lines a minute for `minutes`; return what shipped
	 *  after `from` minutes (the sustained rate, past the initial burst). */
	async function drive(perMinute: number, minutes: number, from: number, text = "") {
		const { logger, lines } = limited();
		let mark = 0;
		for (let m = 0; m < minutes; m++) {
			if (m === from) {
				await logger.flush();
				mark = lines().length;
			}
			for (let i = 0; i < perMinute; i++)
				logger.info("t", `${word(m * perMinute + i)}${text}`);
			await logger.flush();
			now += 60_000;
		}
		// Drop summaries count: every shipped line, bookkeeping included, spends budget.
		return lines().slice(mark);
	}

	test("(a) budget: sustained 600 lines an hour", async () => {
		const second = await drive(60, 120, 60);
		expect(second.length).toBeGreaterThanOrEqual(595);
		expect(second.length).toBeLessThanOrEqual(605);
	});

	test("(a) budget: sustained 2,000 lines a day", async () => {
		// 8 a minute = 480 an hour, under the hour bucket; the day bucket binds.
		const second = await drive(8, 2 * 24 * 60, 24 * 60);
		expect(second.length).toBeGreaterThanOrEqual(1_990);
		expect(second.length).toBeLessThanOrEqual(2_010);
	});

	test("(a) budget: sustained 256 KB a day", async () => {
		const second = await drive(1, 2 * 24 * 60, 24 * 60, ` ${"x".repeat(4_000)}`);
		const bytes = second.reduce((n, e) => n + JSON.stringify(e).length, 0);
		expect(bytes).toBeGreaterThan(240 * 1024);
		expect(bytes).toBeLessThanOrEqual(256 * 1024 + 4_200);
	});

	test("(b) ships only on the 30 s timer, never on a line count", async () => {
		jest.useFakeTimers();
		try {
			const { logger, sent } = limited();
			for (let i = 0; i < 50; i++) logger.info("t", word(i));
			expect(sent).toHaveLength(0);
			jest.advanceTimersByTime(29_999);
			expect(sent).toHaveLength(0);
			jest.advanceTimersByTime(1);
			await Promise.resolve();
			expect(sent).toHaveLength(1);
			expect(sent[0]).toHaveLength(50);
			await logger.destroy();
		} finally {
			jest.useRealTimers();
		}
	});

	test("(b) forced anomalies ship on the timer with diagnostics off", async () => {
		jest.useFakeTimers();
		try {
			const { logger, sent } = limited();
			logger.setEnabled(false);
			logger.anomaly("sync", "first_sync_drop", { n: 1 });
			jest.advanceTimersByTime(30_000);
			await Promise.resolve();
			expect(sent.flat().map((e) => e.message)).toEqual(["first_sync_drop n=1"]);
			await logger.destroy();
		} finally {
			jest.useRealTimers();
		}
	});

	test("(c) throttled reply drops the batch and pauses until retry_after_ms", async () => {
		let reply: PushLogsResult | undefined = { throttled: true, retry_after_ms: 120_000 };
		const { logger, sent } = limited(async () => reply);
		logger.info("t", "refused");
		await logger.flush();
		reply = undefined;
		logger.info("t", "during pause");
		now += 119_000;
		await logger.flush();
		expect(sent).toHaveLength(1);
		now += 1_000;
		await logger.flush();
		expect(sent).toHaveLength(2);
		// Refused batch is gone, not replayed.
		expect(sent[1].map((e) => e.message)).toEqual(["during pause"]);
	});

	test("(c) a non-2xx or network error drops the batch and pauses 30 s", async () => {
		let fail = true;
		const { logger, sent } = limited(async () => {
			if (fail) throw Object.assign(new Error("Request failed, status 500"), { status: 500 });
			return undefined;
		});
		logger.info("t", "lost");
		await logger.flush();
		fail = false;
		logger.info("t", "next");
		now += 29_000;
		await logger.flush();
		expect(sent).toHaveLength(1);
		now += 1_000;
		await logger.flush();
		expect(sent[1].map((e) => e.message)).toEqual(["next"]);
	});

	test("(c) a missing or bad retry_after_ms pauses 30 s; a huge one is capped at 1 h", async () => {
		for (const [retry, pause] of [
			[undefined, 30_000],
			["soon", 30_000],
			[-5, 30_000],
			[Number.NaN, 30_000],
			[10 * 60 * 60_000, 60 * 60_000],
		] as const) {
			let reply: PushLogsResult | undefined = { throttled: true, retry_after_ms: retry };
			const { logger, sent } = limited(async () => reply);
			logger.info("t", "a");
			await logger.flush();
			reply = undefined;
			logger.info("t", "b");
			now += pause - 1;
			await logger.flush();
			expect(sent).toHaveLength(1);
			now += 1;
			await logger.flush();
			expect(sent).toHaveLength(2);
		}
	});

	test("(e) circuit breaker: a message over half a minute's lines is named once and muted 1 h", async () => {
		const { logger, lines } = limited();
		for (let i = 0; i < 40; i++) logger.warn("queue", `retry note ${i} attempt ${i * 7}`);
		logger.info("t", "other");
		await logger.flush();
		const msgs = lines().map((e) => e.message);
		const anomaly = msgs.filter((m) => m.startsWith("log_breaker_muted"));
		expect(anomaly).toHaveLength(1);
		expect(anomaly[0]).toContain("retry note # attempt #");
		expect(msgs.filter((m) => m.startsWith("retry note")).length).toBe(
			LOG_LIMITS.breakerMinLines,
		);
		expect(msgs).toContain("other");

		now += 30 * 60_000;
		logger.warn("queue", "retry note 999 attempt 1");
		await logger.flush();
		expect(lines().map((e) => e.message)).not.toContain("retry note 999 attempt 1");

		now += 30 * 60_000;
		logger.warn("queue", "retry note 1000 attempt 1");
		await logger.flush();
		expect(lines().map((e) => e.message)).toContain("retry note 1000 attempt 1");
	});

	test("(e) a few lines in a quiet minute never trip the breaker", async () => {
		const { logger, lines } = limited();
		for (let i = 0; i < 5; i++) logger.info("t", `seq ${i}`);
		await logger.flush();
		expect(lines()).toHaveLength(5);
	});

	test("(f) remote_log off stops shipping until the next plugin start", async () => {
		let reply: PushLogsResult | undefined = { remote_log: "off" };
		const { logger, sent } = limited(async () => reply);
		logger.info("t", "a");
		await logger.flush();
		reply = undefined;
		logger.anomaly("sync", "even_forced");
		logger.warn("t", "b");
		now += 24 * 60 * 60_000;
		await logger.flush();
		await logger.destroy();
		expect(sent).toHaveLength(1);

		// A fresh logger (next plugin start) ships again.
		const next = limited();
		next.logger.info("t", "c");
		await next.logger.flush();
		expect(next.sent).toHaveLength(1);
	});

	test("older server: no throttled field, keeps shipping on every flush", async () => {
		const { logger, sent } = limited(async () => ({}) as PushLogsResult);
		logger.info("t", "a");
		await logger.flush();
		logger.info("t", "b");
		await logger.flush();
		expect(sent).toHaveLength(2);
	});

	test("remoteLogBudget 0 lifts the budget and the breaker (the e2e suite seeds this)", async () => {
		const { logger, lines } = limited();
		logger.setUnlimited(true);
		for (let i = 0; i < 1000; i++) logger.info("queue", `line ${i}`);
		await logger.flush();
		expect(lines()).toHaveLength(1000);
	});
});

describe("hard cap on every line that leaves the plugin", () => {
	let now = 1_700_000_000_000;
	let realNow: () => number;
	let realDate: () => number;
	beforeEach(() => {
		realNow = performance.now;
		realDate = Date.now;
		performance.now = () => now;
		Date.now = () => now;
	});
	afterEach(() => {
		performance.now = realNow;
		Date.now = realDate;
	});

	const start = (store?: { load(): unknown; save(s: unknown): void }) => {
		const sent: RemoteLogEntry[] = [];
		const logger = new RemoteLogger();
		logger.configure(
			async (b) => {
				sent.push(...b);
				return undefined;
			},
			"1",
			"d",
		);
		logger.setEnabled(true);
		logger.setLevelThreshold("info");
		if (store) logger.setStore(store as never);
		return { logger, sent };
	};
	const letters = (i: number) =>
		String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + (((i / 26) | 0) % 26));
	const bytesOf = (sent: RemoteLogEntry[]) =>
		sent.reduce((n, e) => n + new TextEncoder().encode(JSON.stringify(e)).byteLength, 0);

	test("B1: a hot loop of breaker-tripping shapes ships at most 2,000 lines and 256 KB a day", async () => {
		const { logger, sent } = start();
		// ~300 lines a minute; each file's lines differ only by a counter, so
		// every file is its own breaker shape and trips in turn.
		for (let m = 0; m < 24 * 60; m++) {
			for (let i = 0; i < 300; i++)
				logger.warn("queue", `retry file${letters(i % 40)}x attempt ${m * 300 + i}`);
			await logger.flush();
			now += 60_000;
		}
		expect(sent.length).toBeLessThanOrEqual(LOG_LIMITS.linesPerDay);
		expect(bytesOf(sent)).toBeLessThanOrEqual(LOG_LIMITS.bytesPerDay);
	}, 60_000);

	test("B1: a breaker notice with no budget is dropped and counted, not sent", async () => {
		const { logger, sent } = start();
		for (let m = 0; m < 10; m++) {
			for (let i = 0; i < 60; i++) logger.info("t", `x${letters(m * 60 + i)}`);
			now += 60_000;
		}
		await logger.flush(); // hour budget (600) is spent
		const before = sent.length;
		for (let i = 0; i < 100; i++) logger.warn("queue", `retry alpha attempt ${i}`);
		await logger.flush();
		expect(sent.length).toBe(before);
	});

	test("H1: a restart loop does not reset the day or hour count", async () => {
		const saved: { v: unknown } = { v: null };
		const store = { load: () => saved.v, save: (s: unknown) => (saved.v = structuredClone(s)) };
		let total = 0;
		// 40 starts in 20 hours, each trying 60 lines (34 would beat 2,000 if memory-only).
		for (let r = 0; r < 40; r++) {
			const { logger, sent } = start(store);
			for (let i = 0; i < 60; i++) logger.info("t", `r${letters(r)} ${letters(i)}`);
			await logger.destroy();
			total += sent.length;
			now += 30 * 60_000;
		}
		expect(total).toBeLessThanOrEqual(LOG_LIMITS.linesPerDay);
	});

	test("H1: a restart does not clear a pause", async () => {
		const saved: { v: unknown } = { v: null };
		const store = { load: () => saved.v, save: (s: unknown) => (saved.v = structuredClone(s)) };
		const a = start(store);
		a.logger.configure(async () => ({ throttled: true, retry_after_ms: 120_000 }), "1", "d");
		a.logger.info("t", "refused");
		await a.logger.flush();
		await a.logger.destroy();

		const b = start(store);
		b.logger.info("t", "after restart");
		now += 60_000;
		await b.logger.flush();
		expect(b.sent).toHaveLength(0);
		now += 60_000;
		await b.logger.flush();
		expect(b.sent.map((e) => e.message)).toEqual(["after restart"]);
	});

	test("H1: a burst of lines writes storage once per debounce window, not per line", () => {
		jest.useFakeTimers();
		try {
			const saves: unknown[] = [];
			const { logger } = start({ load: () => null, save: (s) => saves.push(s) });
			for (let i = 0; i < 50; i++) logger.info("t", `l${letters(i)}`);
			expect(saves).toHaveLength(0);
			jest.advanceTimersByTime(LOG_LIMITS.persistDebounceMs);
			expect(saves).toHaveLength(1);
			expect(
				(saves[0] as { hours: number[][] }).hours.reduce((n, h) => n + (h[1] ?? 0), 0),
			).toBe(50);
		} finally {
			jest.useRealTimers();
		}
	});

	test("H1: a corrupt store is ignored, limits still hold", async () => {
		const { logger, sent } = start({
			load: () => ({ dayLines: "lots", pausedUntil: -1 }),
			save() {},
		});
		for (let i = 0; i < 100; i++) logger.info("t", `c${letters(i)}`);
		await logger.flush();
		expect(sent.length).toBeGreaterThan(0);
		expect(sent.length).toBeLessThanOrEqual(LOG_LIMITS.linesPerMinute);
	});

	/** Ship `perMin` lines a minute for `minutes`; return, per minute, how many
	 *  lines and bytes left the plugin. */
	async function hotLoop(perMin: number, minutes: number, pad = "") {
		const { logger, sent } = start();
		const lines: number[] = [];
		const bytes: number[] = [];
		let seen = 0;
		for (let m = 0; m < minutes; m++) {
			for (let i = 0; i < perMin; i++) logger.info("t", `${letters(i)}${letters(m)} ${pad}`);
			await logger.flush();
			const fresh = sent.slice(seen);
			lines.push(fresh.length);
			bytes.push(bytesOf(fresh));
			seen = sent.length;
			now += 60_000;
		}
		return { lines, bytes };
	}
	/** Max sum over any `span` consecutive minutes (both ends inclusive). */
	const maxOver = (xs: number[], span: number) => {
		let best = 0;
		let sum = 0;
		for (let i = 0; i < xs.length; i++) {
			sum += xs[i] ?? 0;
			if (i >= span) sum -= xs[i - span] ?? 0;
			best = Math.max(best, sum);
		}
		return best;
	};

	test("Medium 1: any rolling 24 h of a hot loop is <= 2,000 lines, any 60 min <= 600, any 60 s <= 60", async () => {
		const { lines } = await hotLoop(100, 3 * 24 * 60);
		expect(maxOver(lines, 24 * 60 + 1)).toBeLessThanOrEqual(LOG_LIMITS.linesPerDay);
		expect(maxOver(lines, 60 + 1)).toBeLessThanOrEqual(LOG_LIMITS.linesPerHour);
		expect(maxOver(lines, 1)).toBeLessThanOrEqual(LOG_LIMITS.linesPerMinute * 2);
		// And it is actually shipping (not just refusing everything).
		expect(lines.reduce((a, b) => a + b, 0)).toBeGreaterThan(2 * 1500);
	}, 60_000);

	test("Medium 1: any rolling 24 h of big lines is <= 256 KB", async () => {
		const { bytes } = await hotLoop(1, 3 * 24 * 60, "x".repeat(3_000));
		expect(maxOver(bytes, 24 * 60 + 1)).toBeLessThanOrEqual(LOG_LIMITS.bytesPerDay);
		expect(bytes.reduce((a, b) => a + b, 0)).toBeGreaterThan(2 * 200_000);
	}, 60_000);

	test("Medium 1: any rolling 60 s window holds at most 60 lines", async () => {
		const { logger, sent } = start();
		const at: number[] = [];
		for (let step = 0; step < 600; step++) {
			for (let i = 0; i < 20; i++) logger.info("t", `${letters(i)}${letters(step)}`);
			const before = sent.length;
			await logger.flush();
			for (let k = before; k < sent.length; k++) at.push(now);
			now += 5_000;
		}
		for (let i = 0; i < at.length; i++) {
			const inSpan = at.filter((t) => (at[i] ?? 0) <= t && t < (at[i] ?? 0) + 60_000).length;
			expect(inSpan).toBeLessThanOrEqual(LOG_LIMITS.linesPerMinute);
		}
	});

	// ---- Restart conservation: exact, not "at least". Invariant under test:
	// every line that was SENT is already in the saved count (saved >= sent),
	// and a line that was counted is never refunded by a restart.
	const memStore = () => {
		const saved: { v: unknown } = { v: null };
		return {
			saved,
			store: { load: () => saved.v, save: (s: unknown) => (saved.v = structuredClone(s)) },
		};
	};
	type Saved = { hours: number[][]; minutes: number[][]; pausedUntil: number };
	const total = (rows: number[][] | undefined, col: number) =>
		(rows ?? []).reduce((n, r) => n + (r[col] ?? 0), 0);

	test("High: a kill right after a flush saves EXACTLY what was spent (hung upload)", async () => {
		const { saved, store } = memStore();
		const a = start(store);
		let batch: RemoteLogEntry[] = [];
		a.logger.configure(
			(b) => {
				batch = b;
				return new Promise(() => {}); // upload never answers
			},
			"1",
			"d",
		);
		for (let i = 0; i < 45; i++) a.logger.info("t", `k${letters(i)}`);
		void a.logger.flush(); // app-hide flush; the process is then killed
		const s = saved.v as Saved;
		expect(batch).toHaveLength(45);
		expect(total(s.hours, 1)).toBe(45);
		expect(total(s.minutes, 1)).toBe(45);
		expect(total(s.hours, 2)).toBe(bytesOf(batch));
		expect(total(s.minutes, 2)).toBe(bytesOf(batch));
		expect(s.pausedUntil).toBe(0);
		// Restart: the same minute allows exactly 60 - 0 more only if nothing
		// was remembered; the hour must remember 45, so 600 - 45 remain.
		const b = start(store);
		for (let m = 0; m < 12; m++) {
			for (let i = 0; i < 60; i++) b.logger.info("t", `n${letters(m)}${letters(i)}`);
			await b.logger.flush();
			now += 60_000; // 12 minutes: inside one hour
		}
		expect(b.sent.length).toBe(LOG_LIMITS.linesPerHour - 45);
	});

	test("High: lines spent while a flush waits on an in-flight upload are saved before they are sent", async () => {
		const { saved, store } = memStore();
		const a = start(store);
		let release: () => void = () => {};
		let second: RemoteLogEntry[] = [];
		let calls = 0;
		a.logger.configure(
			(b) => {
				calls++;
				if (calls === 1) return new Promise((r) => (release = () => r(undefined)));
				second = b;
				return new Promise(() => {});
			},
			"1",
			"d",
		);
		a.logger.info("t", "first");
		void a.logger.flush(); // upload #1 in flight
		const waiting = a.logger.flush(); // waits on #1
		for (let i = 0; i < 20; i++) a.logger.info("t", `late${letters(i)}`);
		release();
		await Promise.resolve();
		await Promise.resolve();
		void waiting;
		await new Promise((r) => setTimeout(r, 0));
		expect(second).toHaveLength(20);
		expect(total((saved.v as Saved).hours, 1)).toBe(21);
	});

	test("High: a kill after a throttled reply keeps the pause (saved at once, not debounced)", async () => {
		const { saved, store } = memStore();
		const a = start(store);
		a.logger.configure(async () => ({ throttled: true, retry_after_ms: 120_000 }), "1", "d");
		a.logger.info("t", "refused");
		await a.logger.flush();
		expect((saved.v as Saved).pausedUntil).toBe(now + 120_000); // killed here, no destroy
		const b = start(store);
		b.logger.info("t", "after restart");
		now += 119_000;
		await b.logger.flush();
		expect(b.sent).toHaveLength(0);
		now += 1_000;
		await b.logger.flush();
		expect(b.sent).toHaveLength(1);
	});

	test("High: spend the day cap across two process lifetimes, total sent never exceeds it and equals what was saved", async () => {
		const { saved, store } = memStore();
		let sentTotal = 0;
		const minutesPerLife = [150, 600]; // life 1 ends mid-day, kill; life 2 runs on
		for (const [life, mins] of minutesPerLife.entries()) {
			const { logger, sent } = start(store);
			for (let m = 0; m < mins; m++) {
				for (let i = 0; i < 60; i++)
					logger.info("t", `${letters(life)}${letters(m)}${letters(i)}`);
				await logger.flush();
				now += 60_000;
			}
			sentTotal += sent.length;
			if (life === 0) expect(total((saved.v as Saved).hours, 1)).toBe(sent.length); // exact
			// no destroy: the process is killed
		}
		expect(sentTotal).toBeLessThanOrEqual(LOG_LIMITS.linesPerDay);
		expect(sentTotal).toBeGreaterThan(LOG_LIMITS.linesPerDay - 100); // it did spend the cap
		expect(total((saved.v as Saved).hours, 1)).toBe(sentTotal);
	});

	test("High: a crash with no flush inside the debounce loses count only of lines that were never sent", async () => {
		jest.useFakeTimers();
		try {
			const { saved, store } = memStore();
			const a = start(store);
			for (let i = 0; i < 30; i++) a.logger.info("t", `s${letters(i)}`);
			await a.logger.flush(); // 30 sent, saved
			for (let i = 0; i < 25; i++) a.logger.info("t", `u${letters(i)}`);
			jest.advanceTimersByTime(LOG_LIMITS.persistDebounceMs - 1);
			// crash here: 25 spent lines never reached the store
			expect(a.sent).toHaveLength(30);
			expect(total((saved.v as Saved).hours, 1)).toBe(30); // saved == sent: nothing sent is uncounted
			// Worst case of the hole: bounded by one minute's cap, and never sent.
			const spent = 30 + 25;
			expect(spent - total((saved.v as Saved).hours, 1)).toBeLessThanOrEqual(
				LOG_LIMITS.linesPerMinute,
			);
		} finally {
			jest.useRealTimers();
		}
	});

	test("High: a crash loop with no flush never sends, and the saved count never trails what was sent", async () => {
		const { saved, store } = memStore();
		let sentTotal = 0;
		for (let life = 0; life < 100; life++) {
			const a = start(store);
			for (let i = 0; i < 60; i++) a.logger.info("t", `${letters(life)}${letters(i)}`);
			if (life % 4 === 3) await a.logger.flush(); // some lives flush
			sentTotal += a.sent.length;
			expect(total((saved.v as Saved | null)?.hours, 1)).toBeGreaterThanOrEqual(sentTotal);
			now += 10 * 60_000;
		}
		expect(sentTotal).toBeLessThanOrEqual(LOG_LIMITS.linesPerDay);
	});

	test("High: a flush with nothing to send still saves a pending count", async () => {
		const saves: unknown[] = [];
		const a = start({ load: () => null, save: (s) => saves.push(s) });
		a.logger.info("t", "one");
		await a.logger.flush();
		expect(saves).toHaveLength(1);
	});

	test("Medium 2: muted lines are counted and reported once, in one charged line, when the mute ends", async () => {
		const { logger, sent } = start();
		let total = 0;
		for (let m = 0; m < 60; m++) {
			for (let i = 0; i < 30; i++) logger.error("sync", `upload failed note ${m * 30 + i}`);
			total += 30;
			await logger.flush();
			now += 60_000;
		}
		now += 60_000; // past the one-hour mute
		await logger.flush();
		const msgs = sent.map((e) => e.message);
		expect(msgs.filter((x) => x.startsWith("upload failed"))).toHaveLength(
			LOG_LIMITS.breakerMinLines,
		);
		const end = msgs.filter((x) => x.startsWith("log_breaker_unmuted"));
		expect(end).toHaveLength(1);
		expect(end[0]).toContain(`lines=${total - LOG_LIMITS.breakerMinLines}`);
	});

	test("M1: a long separator-free message does not stall the breaker (regex backtracking)", async () => {
		const { logger } = start();
		// Clocks are mocked here; hrtime is the real one.
		const wall = process.hrtime.bigint();
		for (let i = 0; i < 100; i++) logger.info("t", `${"x".repeat(5000)}${letters(i)}`);
		const ms = Number(process.hrtime.bigint() - wall) / 1e6;
		expect(ms).toBeLessThan(500);
	});

	test("M1: lines that differ only by path, hash or uuid trip the breaker", async () => {
		const { logger, sent } = start();
		for (let i = 0; i < 40; i++) {
			const hex = (0x9f3c1a00 + i * 977).toString(16);
			const uuid = `${hex}-1111-4222-8333-${hex}${hex.slice(0, 4)}`;
			logger.warn(
				"queue",
				`Echo skip (attachment): Projects/${letters(i)}/img ${letters(i + 7)}.png | hash=${hex} id=${uuid}`,
			);
		}
		await logger.flush();
		const msgs = sent.map((e) => e.message);
		expect(msgs.filter((m) => m.startsWith("log_breaker_muted"))).toHaveLength(1);
		expect(msgs.filter((m) => m.startsWith("Echo skip"))).toHaveLength(
			LOG_LIMITS.breakerMinLines,
		);
		expect(msgs.find((m) => m.startsWith("log_breaker_muted"))).toContain("<path>");
	});
});

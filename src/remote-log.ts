/**
 * Remote logger — ships plugin errors and lifecycle events to the backend.
 *
 * Independent from dev-log.ts (which is tree-shaken in production).
 * Accepts a pushFn callback to avoid circular dependency with api.ts.
 */

import { scrubLogText, scrubStack } from "./error-util";

export interface RemoteLogEntry {
	ts: string;
	level: "error" | "warn" | "info";
	category: string;
	message: string;
	stack?: string;
	plugin_version: string;
	platform: string;
	conn_id?: string;
	device_id?: string;
	vault_id?: string;
	seq?: number;
	diagnostic?: boolean;
	/** This entry came from the always-on call site (`anomaly()`), which is
	 *  EXEMPT from the diagnostics gate.
	 *
	 *  Deliberately not "bypassed the gate": an anomaly from a user who HAS
	 *  opted in is still marked, because nothing was bypassed there. The
	 *  question the flag answers is "does this signal cover the whole fleet, or
	 *  only opted-in users?" — and only the call site determines that.
	 *
	 *  Provenance, not severity. Without it a forced anomaly is byte-identical
	 *  to an ordinary warn once stored, so nothing downstream can make that
	 *  distinction — and a test asserting "disabling stops the flush" cannot
	 *  exempt the one class contractually allowed through. */
	forced?: boolean;
}

/** What `POST /api/logs` answers. Every field is optional: an older server
 *  sends none of them, and `undefined` is a push that reported nothing.
 *  - `throttled` + `retry_after_ms`: the server's per-device budget refused
 *    the batch (still a 200, so no client retries it).
 *  - `remote_log: "off"`: the server wants no more lines from this install. */
export interface PushLogsResult {
	throttled?: boolean;
	retry_after_ms?: unknown;
	remote_log?: unknown;
}

type PushFn = (entries: RemoteLogEntry[]) => Promise<PushLogsResult | undefined>;

/** Shipping threshold for log entries. A call ships only if its own level's
 *  severity is at or above the configured threshold. "debug" has no emitting
 *  call sites yet (reserved for future verbose logging behind the dial). */
export type RemoteLogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_SEVERITY: Record<RemoteLogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

/** Every limit the remote logger enforces. One block, one source of truth.
 *  Design rule: a plugin must never be able to send many logs, whatever loops.
 *
 *  - flushIntervalMs: the ONLY automatic send. No line-count flush, so a burst
 *    cannot turn into a burst of requests (at most one POST per 30 s, plus the
 *    explicit flush on app-hide and unload).
 *  - maxBuffer: ring cap between sends.
 *  - repeatWindowMs: identical lines inside it ship once, then one "x N more".
 *  - linesPerMinute/Hour/Day, bytesPerDay: FIXED windows (a window opens at
 *    its first line and lasts exactly its period; nothing carries over). A
 *    line ships only when every window has room; the rest are dropped on the
 *    device, counted, and reported in one line when budget returns. EVERY line
 *    that leaves the plugin is charged, errors, forced anomalies, breaker
 *    notices and drop summaries included; a notice with no room is dropped and
 *    counted. The hour and day windows (and the pause) are persisted through
 *    the store, written at most once per persistDebounceMs, so a restart loop
 *    does not reset them. Under sustained overload the drop summary goes out
 *    at most once per dropSummaryMinMs, plus once at unload.
 *    Worst case: no window ever holds more than its quota (60 / 600 / 2,000
 *    lines, 256 KB). A rolling period that straddles a window boundary can
 *    hold up to twice a window's quota (120 lines in 60 s, 1,200 in an hour);
 *    a rolling 24 h is bounded by the hour windows inside it.
 *  - pause*: after a throttled reply or any failed push, the batch is dropped
 *    (never requeued) and nothing ships until retry_after_ms, else 30 s,
 *    capped at an hour.
 *  - breaker*: one message shape (digits stripped) holding more than half of
 *    a minute's lines, once it has at least breakerMinLines, is named in one
 *    line and muted for breakerMuteMs. */
export const LOG_LIMITS = {
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
} as const;

/** Where the persisted windows live (Obsidian's per-device local storage). */
export const LOG_LIMIT_STORE_KEY = "engram-remote-log-limits";

/** The part of the budget that must survive a restart. Wall-clock based
 *  (a monotonic clock does not outlive the process). */
export interface LogLimitState {
	hourStart: number | null;
	hourLines: number;
	dayStart: number | null;
	dayLines: number;
	dayBytes: number;
	pausedUntil: number;
}

export interface LogLimitStore {
	load(): unknown;
	save(state: LogLimitState): void;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** One fixed window: opens at its first line, closes `periodMs` later. */
interface Win {
	start: number | null;
	lines: number;
	bytes: number;
}

const newWin = (): Win => ({ start: null, lines: 0, bytes: 0 });

/** Roll `w` if its period is over. A clock that moved back keeps the window
 *  (counts stay, nothing is refunded) unless it moved back by more than a
 *  period, which restarts the window instead of stalling it for days. */
function roll(w: Win, periodMs: number, now: number): void {
	if (w.start === null || now - w.start >= periodMs || w.start - now > periodMs) {
		w.start = now;
		w.lines = 0;
		w.bytes = 0;
	}
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).byteLength;

/** How long a refused or failed push pauses shipping. */
function pauseMs(retryAfterMs: unknown): number {
	return typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
		? Math.min(retryAfterMs, LOG_LIMITS.pauseMaxMs)
		: LOG_LIMITS.pauseDefaultMs;
}

/** `retry_after_ms` from a failed push's JSON body, if it has one. */
function retryAfterOf(e: unknown): unknown {
	const err = e as { json?: { retry_after_ms?: unknown }; text?: unknown };
	if (err?.json && typeof err.json === "object") return err.json.retry_after_ms;
	if (typeof err?.text !== "string") return undefined;
	try {
		return (JSON.parse(err.text) as { retry_after_ms?: unknown })?.retry_after_ms;
	} catch {
		return undefined;
	}
}

const SHAPE_CHARS = 200;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PATH_RE =
	/[^\s|,;()]*[\\/][^\s|,;()]*|[^\s|,;()/]+\.(?:md|canvas|base|png|jpe?g|gif|webp|svg|pdf|mp[34]|wav|txt|json|csv)\b/gi;
const HEX_RE = /\b(?=[0-9a-f]*\d)[0-9a-f]{6,}\b/gi;

/** A message's shape for the circuit breaker: uuids, paths, hex ids and
 *  hashes, and numbers collapsed, so `Echo skip: a/b.md | hash=9f3c1a`
 *  and the same line for any other file are one message. */
const shapeOf = (level: string, category: string, message: string) =>
	// Prefix only: the shape needs no more than the notice names (200), and the
	// path pattern backtracks quadratically on a long run with no separator.
	`${level}|${category}|${message
		.slice(0, SHAPE_CHARS)
		.replace(UUID_RE, "#")
		.replace(PATH_RE, "<path>")
		.replace(HEX_RE, "#")
		.replace(/\d+/g, "#")}`;

/** Monotonic clock for every window here. Wall-clock jumps (NTP, sleep,
 *  manual changes) must not stall or skip a window. */
const monoNow = (): number => performance.now();

/** The shape an anomaly line may take.
 *
 *  Values are numbers and booleans ONLY. A string cannot be passed, so there is
 *  no free text to sanitize and nothing to evade — which is the point.
 */
export type AnomalyCounts = Record<string, number | boolean>;

/** A fixed, developer-written slug: lowercase, digits, underscores. */
const ANOMALY_CODE = /^[a-z0-9_]+$/;

/** Return `value` only if it is a slug string, else `fallback`.
 *
 *  Returns the FALLBACK for a non-string rather than the input: `RegExp.test`
 *  stringifies its argument, so a bare ternary handed `12345` back the number
 *  and made the `: string` return type a lie. Only reachable through an
 *  untyped call, but this is the function that decides what ships. */
function safeSlug(value: unknown, fallback: string): string {
	return typeof value === "string" && ANOMALY_CODE.test(value) ? value : fallback;
}

/** Render an anomaly line from a code and counts.
 *
 *  Replaces a free-text message plus a redactor. The redactor could not work:
 *  it split on whitespace, so `Divorce settlement draft.md` lost only its last
 *  token, and `TFile.basename` — which Obsidian returns WITHOUT the extension —
 *  survived whole. A note title IS prose; no text filter can separate it from a
 *  reason string, because there is no difference to find.
 *
 *  So the free text is gone. `code` is a literal slug and anything else becomes
 *  `invalid_code`; values are coerced to a number or a boolean and anything
 *  else is dropped. A path cannot be expressed in this type. */
export function formatAnomaly(code: string, counts: AnomalyCounts | null = {}): string {
	const safeCode = safeSlug(code, "invalid_code");
	const pairs = Object.entries(counts ?? {}).flatMap(([key, value]) => {
		if (!ANOMALY_CODE.test(key)) return [];
		if (typeof value === "boolean") return [`${key}=${value}`];
		return Number.isFinite(value) ? [`${key}=${value}`] : [];
	});
	return pairs.length > 0 ? `${safeCode} ${pairs.join(" ")}` : safeCode;
}

export class RemoteLogger {
	private buffer: RemoteLogEntry[] = [];
	private flushTimer: number | null = null;
	private pushFn: PushFn | null = null;
	private enabled = false;
	private pluginVersion = "";
	private platform = "";
	private inflight: Promise<void> | null = null;
	private connId: string | null = null;
	private deviceId: string | null = null;
	private vaultId: string | null = null;
	private seq = 0;
	private levelThreshold: RemoteLogLevel = "warn";
	private repeats = new Map<
		string,
		{
			level: RemoteLogEntry["level"];
			category: string;
			message: string;
			forced: boolean;
			since: number;
			count: number;
		}
	>();
	/** e2e only (`remoteLogBudget: 0`): no buckets, no breaker. */
	private unlimited = false;
	private minute = newWin();
	private hour = newWin();
	private day = newWin();
	private store: LogLimitStore | null = null;
	private saveTimer: number | null = null;
	private budgetDropped = 0;
	private lastDropReport: number | null = null;
	/** Wall-clock ms before which nothing ships (throttled or failed push).
	 *  Wall, not monotonic, so it survives a restart. */
	private pausedUntil = 0;
	/** The server said `remote_log: "off"`: silent until the next plugin start
	 *  (this logger is rebuilt on every load, so the flag dies with it). */
	private serverOff = false;
	private breakerMinute = { since: 0, total: 0, shapes: new Map<string, number>() };
	private muted = new Map<string, number>();

	configure(pushFn: PushFn, pluginVersion: string, platform: string): void {
		this.pushFn = pushFn;
		this.pluginVersion = pluginVersion;
		this.platform = platform;
		// Always on: forced anomalies ship with diagnostics off, and this timer
		// is their only automatic send. An empty buffer costs one comparison.
		this.startTimer();
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (!enabled) {
			// The user turned logging off: drop, do not ship, everything that
			// only consent allowed. Pending repeat windows would otherwise turn
			// into "x N more" summaries on a later flush (test_66 caught 29 such
			// rows after disable). Forced anomalies are exempt from the switch,
			// so they stay and still go out.
			for (const [key, r] of this.repeats) if (!r.forced) this.repeats.delete(key);
			this.buffer = this.buffer.filter((e) => e.forced);
			void this.flush();
		}
	}

	error(category: string, message: string, stack?: string): void {
		this.addEntry("error", category, message, stack);
	}

	warn(category: string, message: string): void {
		this.addEntry("warn", category, message);
	}

	info(category: string, message: string): void {
		this.addEntry("info", category, message);
	}

	setConnId(id: string | null): void {
		this.connId = id;
	}

	/** Set the minimum severity that ships. Entries below this level are
	 *  dropped before buffering (they never count toward the ring buffer or
	 *  send budget). Default "warn": info is opt-in volume. */
	setLevelThreshold(level: RemoteLogLevel): void {
		this.levelThreshold = level;
	}

	/** Lift the send budget and the circuit breaker. e2e only: the suite
	 *  seeds `remoteLogBudget: 0` and reads info lines from a long session. */
	setUnlimited(unlimited: boolean): void {
		this.unlimited = unlimited;
	}

	/** Restore the persisted hour/day windows and pause, and keep them saved
	 *  (debounced). Storage trouble degrades to in-memory limits; it is never
	 *  logged, since a log line here would feed this logger. */
	setStore(store: LogLimitStore): void {
		this.store = store;
		let raw: unknown;
		try {
			raw = store.load();
		} catch {
			return;
		}
		const r = raw as Partial<Record<keyof LogLimitState, unknown>> | null;
		if (!r || typeof r !== "object") return;
		const num = (v: unknown): v is number =>
			typeof v === "number" && Number.isFinite(v) && v >= 0;
		const at = (v: unknown): number | null => (num(v) ? v : null);
		const now = Date.now();
		if (num(r.hourLines))
			Object.assign(this.hour, { start: at(r.hourStart), lines: r.hourLines });
		if (num(r.dayLines) && num(r.dayBytes))
			Object.assign(this.day, {
				start: at(r.dayStart),
				lines: r.dayLines,
				bytes: r.dayBytes,
			});
		if (num(r.pausedUntil))
			this.pausedUntil = Math.min(r.pausedUntil, now + LOG_LIMITS.pauseMaxMs);
	}

	private dirty(): void {
		if (!this.store || this.saveTimer !== null) return;
		this.saveTimer = window.setTimeout(() => this.saveNow(), LOG_LIMITS.persistDebounceMs);
	}

	private saveNow(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		try {
			this.store?.save({
				hourStart: this.hour.start,
				hourLines: this.hour.lines,
				dayStart: this.day.start,
				dayLines: this.day.lines,
				dayBytes: this.day.bytes,
				pausedUntil: this.pausedUntil,
			});
		} catch {
			// In-memory limits still hold for this session.
		}
	}

	setClientContext(deviceId: string | null, vaultId: string | null): void {
		this.deviceId = deviceId;
		this.vaultId = vaultId;
	}

	/** Diagnostic-flagged info entry (verbose firehose). The backend ships
	 *  diagnostic entries to Loki even at info level. */
	diag(category: string, message: string): void {
		this.addEntry("info", category, message, undefined, true);
	}

	async flush(): Promise<void> {
		const now = monoNow();
		this.closeRepeatWindows(now, false);
		this.reportDropped(false);
		// Wait out an in-flight batch instead of returning: a flush that no-ops
		// while the timer flush is still posting left destroy() to discard
		// whatever was buffered after it (including the unload drop count).
		while (this.inflight) await this.inflight;
		if (this.serverOff || this.buffer.length === 0 || !this.pushFn) return;
		// Throttled or failed: nothing ships, nothing retries, until the pause ends.
		const wall = Date.now();
		// A clock set back must not stretch a pause past the cap.
		this.pausedUntil = Math.min(this.pausedUntil, wall + LOG_LIMITS.pauseMaxMs);
		if (wall < this.pausedUntil) return;

		const batch = this.buffer.splice(0, this.buffer.length);
		let sent: Promise<PushLogsResult | undefined>;
		try {
			sent = this.pushFn(batch);
		} catch (e) {
			sent = Promise.reject(e instanceof Error ? e : new Error(String(e)));
		}
		this.inflight = sent.then(
			() => {},
			() => {},
		);

		try {
			const reply = await sent;
			if (reply?.remote_log === "off") {
				this.serverOff = true;
				this.buffer = [];
			} else if (reply?.throttled === true) {
				this.pausedUntil = Date.now() + pauseMs(reply.retry_after_ms);
				this.dirty();
			}
		} catch (e) {
			// The batch is dropped, never requeued: a retry loop is exactly the
			// volume this logger exists to prevent.
			this.pausedUntil = Date.now() + pauseMs(retryAfterOf(e));
			this.dirty();
		} finally {
			this.inflight = null;
		}
	}

	async destroy(): Promise<void> {
		this.stopTimer();
		this.closeRepeatWindows(monoNow(), true);
		this.reportDropped(true);
		await this.flush();
		this.saveNow();
		this.buffer = [];
		this.pushFn = null;
	}

	/** A silent failure the user cannot see and we cannot debug. Ships at warn
	 *  EVEN WHEN DIAGNOSTICS ARE OFF, and bypasses the level threshold.
	 *
	 *  Why the bypass exists: `diagnosticsEnabled` defaults false, so every
	 *  rlog() call is a no-op on a fresh install — and a user's FIRST sync is
	 *  simultaneously the most likely thing to break and the least likely to
	 *  have telemetry enabled. Prod 2026-08-13: a first sync dropped 316 of 316
	 *  notes and produced exactly zero client log lines to look at.
	 *
	 *  CONTRACT — ENFORCED, not asserted in a comment. BOTH string parameters
	 *  are slug-validated and `counts` holds numbers and booleans, so a path, a
	 *  title or note content cannot be expressed in any argument.
	 *
	 *  `category` is validated too, and that is not cosmetic. It was left free
	 *  while `code` was locked down, and it reads like a label slot — so
	 *  `anomaly(file.path, "note_skipped", { seq })` is a natural thing to
	 *  write. It rides the same force:true path, lands in `client_logs.category`
	 *  unvalidated, and the backend interpolates it into a Logger MESSAGE BODY
	 *  (`logs.ex`, "[client:#{category}]"), which RedactFilter refuses to touch
	 *  and which ships to Loki at warn. Same leak the free-text removal was for,
	 *  one argument to the left.
	 *
	 *  The previous shape took free text and ran a redactor over it. That could
	 *  not hold: the redactor split on whitespace, so a filename with spaces
	 *  (`Divorce settlement draft.md`) lost only its final token, and
	 *  `TFile.basename` — no extension — survived intact. A note title is
	 *  prose; no text filter separates it from a reason string, because there
	 *  is nothing to separate. Removing the free text removes the problem. */
	anomaly(category: string, code: string, counts: AnomalyCounts = {}): void {
		this.addEntry(
			"warn",
			safeSlug(category, "invalid_category"),
			formatAnomaly(code, counts),
			undefined,
			false,
			true,
		);
	}

	private addEntry(
		level: "error" | "warn" | "info",
		category: string,
		message: string,
		stack?: string,
		diagnostic?: boolean,
		force?: boolean,
	): void {
		if (!this.pushFn || this.serverOff) return;
		if (!force) {
			if (!this.enabled) return;
			if (LEVEL_SEVERITY[level] < LEVEL_SEVERITY[this.levelThreshold]) return;
		}

		const now = monoNow();
		this.closeRepeatWindows(now, false);
		const key = `${level}|${category}|${message}`;
		const open = this.repeats.get(key);
		if (open) {
			open.count++;
			return;
		}
		this.repeats.set(key, { level, category, message, forced: !!force, since: now, count: 0 });
		this.enqueue(level, category, message, stack, diagnostic, force);
	}

	/** End every repeat window older than LOG_LIMITS.repeatWindowMs (all of them when
	 *  `all`), shipping one summary line for each that swallowed repeats. */
	private closeRepeatWindows(now: number, all: boolean): void {
		// Map order is insertion order is `since` order, so the first window
		// still open ends the scan: cost is the number of CLOSED windows.
		for (const [key, r] of this.repeats) {
			if (!all && now - r.since < LOG_LIMITS.repeatWindowMs) break;
			this.repeats.delete(key);
			// Never emit a consent-only summary while logging is off.
			if (r.count === 0 || (!r.forced && !this.enabled)) continue;
			const secs = Math.max(1, Math.round((now - r.since) / 1000));
			this.enqueue(
				r.level,
				r.category,
				`${r.message} x ${r.count.toLocaleString("en-US")} more in ${secs}s`,
				undefined,
				false,
				r.forced,
			);
		}
	}

	/** True when every window can take one more line (and `bytes` more bytes). */
	private room(bytes: number, now: number): boolean {
		roll(this.minute, MINUTE_MS, now);
		roll(this.hour, HOUR_MS, now);
		roll(this.day, DAY_MS, now);
		return (
			this.minute.lines < LOG_LIMITS.linesPerMinute &&
			this.hour.lines < LOG_LIMITS.linesPerHour &&
			this.day.lines < LOG_LIMITS.linesPerDay &&
			this.day.bytes + bytes <= LOG_LIMITS.bytesPerDay
		);
	}

	/** Charge one built line to every window. False = no room, nothing charged.
	 *  The ONLY gate a line passes to leave the plugin, notices included. */
	private spend(entry: RemoteLogEntry, now: number): boolean {
		const bytes = utf8Bytes(JSON.stringify(entry));
		if (!this.room(bytes, now)) return false;
		for (const w of [this.minute, this.hour, this.day]) w.lines++;
		this.day.bytes += bytes;
		this.dirty();
		return true;
	}

	/** Circuit breaker. True = this line is muted (do not ship). */
	private tripped(
		level: string,
		category: string,
		message: string,
		forced: boolean,
		now: number,
	): boolean {
		const shape = shapeOf(level, category, message);
		const until = this.muted.get(shape);
		if (until !== undefined) {
			if (now < until) return true;
			this.muted.delete(shape);
		}
		const m = this.breakerMinute;
		if (now - m.since >= MINUTE_MS) {
			m.since = now;
			m.total = 0;
			m.shapes.clear();
		}
		m.total++;
		const n = (m.shapes.get(shape) ?? 0) + 1;
		// ponytail: a minute of all-distinct shapes grows this map up to the
		// line count of that minute; cleared every minute.
		m.shapes.set(shape, n);
		if (n <= LOG_LIMITS.breakerMinLines || n <= m.total * LOG_LIMITS.breakerShare) return false;
		this.muted.set(shape, now + LOG_LIMITS.breakerMuteMs);
		const share = Math.round((n / m.total) * 100);
		const named = shape.slice(shape.indexOf("|", shape.indexOf("|") + 1) + 1).slice(0, 200);
		// Charged like any line: with no room the notice is dropped and counted.
		// Forced only when the line it names was (anomaly text is slug-only).
		if (
			!this.notice(
				`log_breaker_muted share=${share}% lines=${n} mute_s=${LOG_LIMITS.breakerMuteMs / 1000} category=${category} message=${named}`,
				forced,
			)
		)
			this.budgetDropped++;
		return true;
	}

	/** Ship the drop count, if any. It is a notice like any other: with no
	 *  room it stays counted and waits. Rate-limited unless `unload`. */
	private reportDropped(unload: boolean): void {
		if (this.budgetDropped === 0) return;
		const mono = monoNow();
		if (
			!unload &&
			this.lastDropReport !== null &&
			mono - this.lastDropReport < LOG_LIMITS.dropSummaryMinMs
		)
			return;
		if (
			!this.notice(formatAnomaly("log_budget_dropped", { dropped: this.budgetDropped }), true)
		)
			return;
		this.budgetDropped = 0;
		this.lastDropReport = mono;
	}

	/** Logger bookkeeping line (drop summary, breaker trip), charged to the
	 *  same windows as every other line. False = no room, not shipped. */
	private notice(message: string, forced: boolean): boolean {
		if (!this.pushFn) return false;
		const entry = this.build("warn", "remote_log", message, undefined, false, forced);
		if (!this.unlimited && !this.spend(entry, Date.now())) return false;
		this.push(entry);
		return true;
	}

	private enqueue(
		level: "error" | "warn" | "info",
		category: string,
		message: string,
		stack?: string,
		diagnostic?: boolean,
		force?: boolean,
	): void {
		if (!this.unlimited) {
			// Cheap refusal first: with no room the line is gone either way, so a
			// hot loop pays no shape regexes, build or stringify.
			if (!this.room(0, Date.now())) {
				this.budgetDropped++;
				return;
			}
			if (this.tripped(level, category, message, !!force, monoNow())) return;
			this.reportDropped(false);
		}
		const entry = this.build(level, category, message, stack, diagnostic, force);
		if (!this.unlimited && !this.spend(entry, Date.now())) {
			this.budgetDropped++;
			return;
		}
		this.push(entry);
	}

	private build(
		level: "error" | "warn" | "info",
		category: string,
		message: string,
		stack?: string,
		diagnostic?: boolean,
		force?: boolean,
	): RemoteLogEntry {
		const entry: RemoteLogEntry = {
			ts: new Date().toISOString(),
			level,
			category,
			// Egress chokepoint: every message and stack is path-scrubbed HERE, so
			// a call site that forgets noteRef()/errMsg(e, path) — or passes a raw
			// `e.stack`, whose header is the unscrubbed error message — still can't
			// ship a path or OS username to client_logs / Loki.
			message: scrubLogText(message),
			plugin_version: this.pluginVersion,
			platform: this.platform,
			seq: this.seq++,
		};
		// Verbose mode opts sub-warn entries into Loki. The backend keeps client
		// logs out of Loki below warn (Category: :client is absent from
		// @info_to_loki, so a whole plugin fleet can't flood it) and offers
		// exactly one escape hatch: `diagnostic: true`. Without this, setting
		// remoteLogLevel to "debug" made the plugin SEND info lines that the
		// backend then dropped — verbose logging that produced nothing to read.
		// Gated on "debug", never the "info" default, so the flood guard still
		// holds for everyone who hasn't explicitly asked for the firehose.
		// warn/error already ship, so flagging them would just pad the payload.
		if (this.levelThreshold === "debug" && LEVEL_SEVERITY[level] < LEVEL_SEVERITY.warn) {
			entry.diagnostic = true;
		}
		if (stack) entry.stack = scrubStack(stack);
		if (this.connId) entry.conn_id = this.connId;
		if (this.deviceId) entry.device_id = this.deviceId;
		if (this.vaultId) entry.vault_id = this.vaultId;
		if (diagnostic) entry.diagnostic = true;
		if (force) entry.forced = true;
		return entry;
	}

	/** Buffer only. Sending happens on the timer (or an explicit flush). */
	private push(entry: RemoteLogEntry): void {
		this.buffer.push(entry);
		// ponytail: unlimited (e2e only) keeps every line until the next flush,
		// since the oracles read lines a ring would evict; memory is unbounded there.
		if (!this.unlimited && this.buffer.length > LOG_LIMITS.maxBuffer) {
			this.buffer.splice(0, this.buffer.length - LOG_LIMITS.maxBuffer);
		}
	}

	private startTimer(): void {
		this.stopTimer();
		this.flushTimer = window.setInterval(() => {
			void this.flush();
		}, LOG_LIMITS.flushIntervalMs);
	}

	private stopTimer(): void {
		if (this.flushTimer) {
			window.clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
	}
}

interface NoopLogger {
	error(category: string, message: string, stack?: string): void;
	warn(category: string, message: string): void;
	info(category: string, message: string): void;
	diag(category: string, message: string): void;
	anomaly(category: string, code: string, counts?: AnomalyCounts): void;
	setConnId(id: string | null): void;
	setClientContext(deviceId: string | null, vaultId: string | null): void;
	setLevelThreshold(level: RemoteLogLevel): void;
	setUnlimited(unlimited: boolean): void;
	flush(): Promise<void>;
	destroy(): Promise<void>;
	setEnabled(enabled: boolean): void;
	configure(pushFn: PushFn, pluginVersion: string, platform: string): void;
}

const _noop: NoopLogger = {
	error() {},
	warn() {},
	info() {},
	diag() {},
	anomaly() {},
	setConnId() {},
	setClientContext() {},
	setLevelThreshold() {},
	setUnlimited() {},
	async flush() {},
	async destroy() {},
	setEnabled() {},
	configure() {},
};

let _instance: RemoteLogger | null = null;

export function initRemoteLog(): RemoteLogger {
	_instance = new RemoteLogger();
	return _instance;
}

export function rlog(): RemoteLogger | NoopLogger {
	return _instance ?? _noop;
}

export async function destroyRemoteLog(): Promise<void> {
	await _instance?.destroy();
	_instance = null;
}

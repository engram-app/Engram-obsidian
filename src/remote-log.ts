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

type PushFn = (entries: RemoteLogEntry[]) => Promise<void>;

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

const MAX_BUFFER = 200;
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_THRESHOLD = 20;

/** Identical lines (same level, category and message) inside this window ship
 *  ONCE; the repeats become a single "xN" summary line when the window ends.
 *  A loop re-emits the same line verbatim (the #675 attachment echo-skip loop
 *  sent one line ~2.5 times a second for four days), so exact match catches
 *  it without merging lines that differ by a note id or seq, which the e2e
 *  log oracle and humans need to tell apart. */
export const REPEAT_WINDOW_MS = 60_000;

/** Lines this logger may enqueue per BUDGET_WINDOW_MS, whatever produced them.
 *  The backend keeps at most 500 lines per device per 10 minutes (Engram#2369)
 *  and drops the rest server-side, AFTER the client paid the bandwidth and the
 *  server paid the parse. 200 sits well under that cap, so the server cap never
 *  truncates a burst that holds the one useful error, and it is still ~20x
 *  what a healthy diagnostics session at warn emits. Overflow is counted and
 *  reported as one line when the window rolls. 0 = unlimited (CI only: the
 *  e2e suite reads info lines from a session-long device). */
export const DEFAULT_LINE_BUDGET = 200;
export const BUDGET_WINDOW_MS = 10 * 60_000;

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
	private flushing = false;
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
	private lineBudget = DEFAULT_LINE_BUDGET;
	private budgetSince = 0;
	private budgetUsed = 0;
	private budgetDropped = 0;

	configure(pushFn: PushFn, pluginVersion: string, platform: string): void {
		this.pushFn = pushFn;
		this.pluginVersion = pluginVersion;
		this.platform = platform;
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		if (enabled) {
			this.startTimer();
		} else {
			this.stopTimer();
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
	 *  flush threshold). Default "warn": info is opt-in volume. */
	setLevelThreshold(level: RemoteLogLevel): void {
		this.levelThreshold = level;
	}

	/** Lines allowed per BUDGET_WINDOW_MS; 0 lifts the cap. */
	setLineBudget(lines: number): void {
		this.lineBudget = lines;
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
		this.closeRepeatWindows(Date.now(), false);
		if (this.flushing || this.buffer.length === 0 || !this.pushFn) return;

		const batch = this.buffer.splice(0, this.buffer.length);
		this.flushing = true;

		try {
			await this.pushFn(batch);
		} catch {
			// Put entries back (up to MAX_BUFFER)
			const space = MAX_BUFFER - this.buffer.length;
			if (space > 0) {
				this.buffer.unshift(...batch.slice(0, space));
			}
		} finally {
			this.flushing = false;
		}
	}

	async destroy(): Promise<void> {
		this.stopTimer();
		this.closeRepeatWindows(Date.now(), true);
		await this.flush();
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
		if (!this.pushFn) return;
		if (!force) {
			if (!this.enabled) return;
			if (LEVEL_SEVERITY[level] < LEVEL_SEVERITY[this.levelThreshold]) return;
		}

		const now = Date.now();
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

	/** End every repeat window older than REPEAT_WINDOW_MS (all of them when
	 *  `all`), shipping one summary line for each that swallowed repeats. */
	private closeRepeatWindows(now: number, all: boolean): void {
		for (const [key, r] of this.repeats) {
			if (!all && now - r.since < REPEAT_WINDOW_MS) continue;
			this.repeats.delete(key);
			if (r.count === 0) continue;
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

	/** Spend one line of budget. Returns false when the window is exhausted.
	 *  Rolling the window reports what the previous one dropped, once. */
	private spendBudget(now: number): boolean {
		if (this.lineBudget <= 0) return true;
		if (now - this.budgetSince >= BUDGET_WINDOW_MS) {
			const dropped = this.budgetDropped;
			this.budgetSince = now;
			this.budgetUsed = 0;
			this.budgetDropped = 0;
			if (dropped > 0) {
				this.budgetUsed++;
				this.push(
					this.build(
						"warn",
						"remote_log",
						formatAnomaly("log_budget_exhausted", { dropped, budget: this.lineBudget }),
						undefined,
						false,
						true,
					),
				);
			}
		}
		if (this.budgetUsed >= this.lineBudget) {
			this.budgetDropped++;
			return false;
		}
		this.budgetUsed++;
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
		if (!this.spendBudget(Date.now())) return;
		this.push(this.build(level, category, message, stack, diagnostic, force));
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

	private push(entry: RemoteLogEntry): void {
		this.buffer.push(entry);

		// Ring buffer: drop oldest if over limit
		if (this.buffer.length > MAX_BUFFER) {
			this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
		}

		// Flush immediately if threshold reached
		if (this.buffer.length >= FLUSH_THRESHOLD) {
			void this.flush();
		}
	}

	private startTimer(): void {
		this.stopTimer();
		this.flushTimer = window.setInterval(() => {
			void this.flush();
		}, FLUSH_INTERVAL_MS);
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
	setLineBudget(lines: number): void;
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
	setLineBudget() {},
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

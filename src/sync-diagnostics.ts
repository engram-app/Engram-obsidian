/**
 * Always-on outcome lines for the failures a mobile user can only describe as
 * "it didn't work". Each ships through `rlog().anomaly`, which is forced past
 * the diagnostics opt-in and reaches Loki at warn, so the next report is
 * answerable from a LogQL query instead of a request for device logs.
 *
 * Counts, booleans and slugs only: a path, title or error message cannot be
 * expressed (see `formatAnomaly`). Codes are literals; the one runtime-chosen
 * label rides as `reason=<slug>`.
 */
import { statusOf } from "./error-util";
import { PreviewUnavailableError } from "./preview-error";
import { type AnomalyCounts, rlog, slugPart } from "./remote-log";

/** Why the first-sync / review preview could not load. */
export function reportPlanLoadFailure(e: unknown): void {
	if (e instanceof PreviewUnavailableError) {
		const missing = (part: string) => e.detail?.includes(part) ?? false;
		const counts: AnomalyCounts =
			e.reason === "timeout"
				? {
						missing_catchup: missing("catchup"),
						missing_manager: missing("manager"),
						missing_live: missing("live"),
					}
				: {};
		const reason =
			e.reason === "join_rejected" ? `join_rejected_${slugPart(e.detail)}` : e.reason;
		rlog().anomaly("sync", "preview_failed", counts, reason);
		return;
	}
	const status = statusOf(e);
	rlog().anomaly("sync", "preview_failed", status === undefined ? {} : { status }, "other");
}

/** Shortest gap between two join lines, and the most distinct rejection
 *  reasons logged before a join succeeds. A reject/join flap is bounded by
 *  both, whatever the retry cadence. */
const JOIN_LOG_COOLDOWN_MS = 60_000;
const MAX_REJECT_REASONS = 5;

/** Outcome of the `crdt:` topic join. Logs what a query needs and nothing on
 *  the steady state: each distinct rejection reason once until a join
 *  succeeds, the first join of the session, and a join that follows a
 *  rejection. At most one line per cooldown window. */
export function createJoinReporter(now: () => number = Date.now) {
	let everJoined = false;
	let rejections = 0;
	let lastLoggedAt = Number.NEGATIVE_INFINITY;
	const seen = new Set<string>();
	const due = () => {
		if (now() - lastLoggedAt < JOIN_LOG_COOLDOWN_MS) return false;
		lastLoggedAt = now();
		return true;
	};
	return {
		joined(): void {
			if ((!everJoined || rejections > 0) && due()) {
				rlog().anomaly("crdt", "crdt_joined", {
					first: !everJoined,
					after_rejections: rejections,
				});
			}
			everJoined = true;
			rejections = 0;
			seen.clear();
		},
		rejected(reason: string | undefined, min?: number): void {
			const slug = slugPart(reason);
			rejections += 1;
			if (seen.has(slug) || seen.size >= MAX_REJECT_REASONS || !due()) return;
			seen.add(slug);
			const counts: AnomalyCounts = min !== undefined && Number.isFinite(min) ? { min } : {};
			rlog().anomaly("crdt", "crdt_join_rejected", counts, slug);
		},
	};
}

/** One reporter per plugin load (the bundle reloads with the plugin). */
export const joinReporter = createJoinReporter();

/** Sync gate opened or closed. `reason` is a developer-written slug. */
export function reportGateTransition(blocked: boolean, reason: string, waitedS?: number): void {
	if (blocked) {
		rlog().anomaly("sync", "sync_gate_closed", {}, reason);
		return;
	}
	const counts: AnomalyCounts = waitedS === undefined ? {} : { waited_s: Math.round(waitedS) };
	rlog().anomaly("sync", "sync_gate_open", counts, reason);
}

const depthOf = (path: string) => path.split("/").filter(Boolean).length;
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

const BURST_QUIET_MS = 1_000;

/** Folder renames, one line per burst. Obsidian fires a rename for the folder
 *  and again for every nested subfolder, so a descendant of the burst's root
 *  is counted, not logged. The line goes out once the burst goes quiet (or on
 *  `flush`). Never logged before, which left "extra unnamed folder after a
 *  rename" with no first event to find. */
export function createFolderRenameReporter() {
	let root: { from: string; to: string; children: number; descendants: number } | null = null;
	let timer: number | null = null;
	const flush = () => {
		if (timer !== null) window.clearTimeout(timer);
		timer = null;
		if (!root) return;
		const { from, to, children, descendants } = root;
		root = null;
		rlog().anomaly("vault", "folder_renamed", {
			children,
			descendants,
			same_parent: parentOf(from) === parentOf(to),
			depth_from: depthOf(from),
			depth_to: depthOf(to),
		});
	};
	return {
		rename(from: string, to: string, children: number): void {
			if (root && from.startsWith(`${root.from}/`)) {
				root.descendants += 1;
			} else {
				flush();
				root = { from, to, children, descendants: 0 };
			}
			if (timer !== null) window.clearTimeout(timer);
			timer = window.setTimeout(flush, BURST_QUIET_MS);
		},
		flush,
	};
}

const folderRenames = createFolderRenameReporter();
export const reportFolderRename = folderRenames.rename;
export const flushFolderRenames = folderRenames.flush;

const RATE_LINES_PER_HOUR = 12; // 6 start/clear pairs
const HOUR_MS = 3_600_000;

/** 429 start/clear lines, hard-capped per hour so a server that keeps
 *  answering 429 cannot turn every device into a Loki firehose. Past the cap
 *  one `rate_limit_log_suppressed` line says so, and the next hour reports how
 *  many were dropped. `scope` is a developer slug, `retryAfterMs` what the
 *  server asked (absent when it sent none), `waitMs` what we will wait. */
export function createRateLimitReporter(now: () => number = Date.now) {
	let windowStart = Number.NEGATIVE_INFINITY;
	let used = 0;
	let dropped = 0;
	const take = (): boolean => {
		if (now() - windowStart >= HOUR_MS) {
			if (dropped > 0)
				rlog().anomaly("push", "rate_limit_log_suppressed", { count: dropped });
			windowStart = now();
			used = 0;
			dropped = 0;
		}
		if (used < RATE_LINES_PER_HOUR) {
			used += 1;
			return true;
		}
		if (dropped === 0) rlog().anomaly("push", "rate_limit_log_suppressed", { count: 0 });
		dropped += 1;
		return false;
	};
	return {
		limited(scope: string, streak: number, waitMs: number, retryAfterMs?: number): void {
			if (!take()) return;
			const counts: AnomalyCounts = { streak, wait_s: Math.round(waitMs / 1000) };
			if (retryAfterMs !== undefined) counts.retry_after_s = Math.round(retryAfterMs / 1000);
			rlog().anomaly("push", "rate_limited", counts, scope);
		},
		/** The cooldown ended: the first success after `streak` rate-limited tries. */
		cleared(scope: string, streak: number): void {
			if (streak > 0 && take())
				rlog().anomaly("push", "rate_limit_cleared", { streak }, scope);
		},
	};
}

const rateLimits = createRateLimitReporter();
export const reportRateLimited = rateLimits.limited;
export const reportRateLimitCleared = rateLimits.cleared;

/** A folder delete entered the retry set. Edge-triggered by the caller: once
 *  per folder, not once per retry. `pending` is how many are now waiting. */
export function reportFolderDeleteFailed(pending: number, e: unknown): void {
	const status = statusOf(e);
	const counts: AnomalyCounts = { pending };
	if (status !== undefined) counts.status = status;
	rlog().anomaly("vault", "folder_delete_failed", counts);
}

/** A folder left the retry set because its delete finally went through. */
export function reportFolderDeleteCleared(pending: number): void {
	rlog().anomaly("vault", "folder_delete_cleared", { pending });
}

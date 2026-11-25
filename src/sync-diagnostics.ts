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

/** Most distinct rejection reasons logged before a join succeeds. */
const MAX_REJECT_REASONS = 5;

/** Outcome of the `crdt:` topic join. Logs what a query needs and nothing on
 *  the steady state: each distinct rejection reason once until a join
 *  succeeds, the first join of the session, and the recovery after a logged
 *  rejection. Volume is not limited here: every line goes through the remote
 *  logger's device-wide send budget and identical-line collapse (remote-log.ts
 *  `LOG_LIMITS`), the one source of truth for how much a device may send.
 *  `clear` forgets the session: register it with the owner's sweep registry so
 *  a vault switch starts clean. */
export function createJoinReporter() {
	let everJoined = false;
	let rejections = 0;
	let rejectionLogged = false;
	const seen = new Set<string>();
	return {
		joined(): void {
			if (!everJoined || rejectionLogged) {
				rlog().anomaly("crdt", "crdt_joined", {
					first: !everJoined,
					after_rejections: rejections,
				});
			}
			everJoined = true;
			rejections = 0;
			rejectionLogged = false;
			seen.clear();
		},
		rejected(reason: string | undefined, min?: number): void {
			const slug = slugPart(reason);
			rejections += 1;
			if (seen.has(slug) || seen.size >= MAX_REJECT_REASONS) return;
			seen.add(slug);
			rejectionLogged = true;
			const counts: AnomalyCounts = min !== undefined && Number.isFinite(min) ? { min } : {};
			rlog().anomaly("crdt", "crdt_join_rejected", counts, slug);
		},
		clear(): void {
			everJoined = false;
			rejections = 0;
			rejectionLogged = false;
			seen.clear();
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

/** The slice of TimeProvider the reporters need, so the owner's clock and
 *  timer registry drive them and a test advances time instead of sleeping. */
export type DiagnosticsClock = {
	now(): number;
	setTimeout(callback: () => void, ms: number): number;
	clearTimeout(id: number): void;
};

/** Folder renames, one line per burst. Obsidian fires a rename for the folder
 *  and again for every nested subfolder, so a rename that is exactly the
 *  root's move applied to a descendant (same relative path under the new
 *  root) is counted, not logged; any other rename, even under the same
 *  folder, is its own line. The line goes out once the burst goes quiet.
 *  `clear` flushes and cancels the timer: register it with the owner's sweep
 *  registry so unload and a vault switch never strand a pending line.
 *  Never logged before, which left "extra unnamed folder after a rename" with
 *  no first event to find. */
export function createFolderRenameReporter(clock: DiagnosticsClock) {
	let root: { from: string; to: string; children: number; descendants: number } | null = null;
	let timer: number | null = null;
	const clear = () => {
		if (timer !== null) clock.clearTimeout(timer);
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
			const isDescendantMove =
				root !== null &&
				from.startsWith(`${root.from}/`) &&
				to === root.to + from.slice(root.from.length);
			if (root && isDescendantMove) {
				root.descendants += 1;
			} else {
				clear();
				root = { from, to, children, descendants: 0 };
			}
			if (timer !== null) clock.clearTimeout(timer);
			timer = clock.setTimeout(clear, BURST_QUIET_MS);
		},
		clear,
	};
}

/** A 429 cooldown began. `scope` is a developer slug, `retryAfterMs` what the
 *  server asked (absent when it sent none), `waitMs` what we will wait. Volume
 *  is bounded by the remote logger's device-wide budget, not here. */
export function reportRateLimited(
	scope: string,
	streak: number,
	waitMs: number,
	retryAfterMs?: number,
): void {
	const counts: AnomalyCounts = { streak, wait_s: Math.round(waitMs / 1000) };
	if (retryAfterMs !== undefined) counts.retry_after_s = Math.round(retryAfterMs / 1000);
	rlog().anomaly("push", "rate_limited", counts, scope);
}

/** The cooldown ended: the first success after `streak` rate-limited tries. */
export function reportRateLimitCleared(scope: string, streak: number): void {
	if (streak > 0) rlog().anomaly("push", "rate_limit_cleared", { streak }, scope);
}

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

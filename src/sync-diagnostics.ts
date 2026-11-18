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

/** Outcome of the `crdt:` topic join. Logs what a query needs and nothing on
 *  the steady state: a rejection (once per reason until a join succeeds), the
 *  first join of the session, and a join that follows a rejection. */
export function createJoinReporter() {
	let everJoined = false;
	let rejections = 0;
	let lastReason: string | undefined;
	return {
		joined(): void {
			if (!everJoined || rejections > 0) {
				rlog().anomaly("crdt", "crdt_joined", {
					first: !everJoined,
					after_rejections: rejections,
				});
			}
			everJoined = true;
			rejections = 0;
			lastReason = undefined;
		},
		rejected(reason: string | undefined, min?: number): void {
			const slug = slugPart(reason);
			rejections += 1;
			if (slug === lastReason) return;
			lastReason = slug;
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

/** A folder rename/move seen by the vault watcher. Never logged before, which
 *  left "extra unnamed folder after a rename" with no first event to find. */
export function reportFolderRename(oldPath: string, newPath: string, children: number): void {
	rlog().anomaly("vault", "folder_renamed", {
		children,
		same_parent: parentOf(oldPath) === parentOf(newPath),
		depth_from: depthOf(oldPath),
		depth_to: depthOf(newPath),
	});
}

/** A 429 cooldown began. `scope` is a developer slug, `retryAfterMs` what the
 *  server asked (absent when it sent none), `waitMs` what we will actually wait. */
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

/** A folder delete the server refused or never answered. `pending` is how many
 *  deletes are now waiting to be retried. */
export function reportFolderDeleteFailed(
	phase: "push" | "pull",
	pending: number,
	e: unknown,
): void {
	const status = statusOf(e);
	const counts: AnomalyCounts = { pending };
	if (status !== undefined) counts.status = status;
	rlog().anomaly("vault", "folder_delete_failed", counts, phase);
}

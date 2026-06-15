import { LimitExceededError } from "./limit-error";
import type { SyncIssue, SyncIssueCategory } from "./types";

/** Persistent store of sync failures keyed by file path.
 *
 *  Lives across plugin reloads so the user always sees "what's broken and why"
 *  in the Sync Center. Failures recorded here are the source of truth for the
 *  Issues panel; the offline queue retries network/server failures, but
 *  terminal failures (e.g. 413 Payload Too Large) are kept here without
 *  re-enqueueing so they don't loop forever.
 */
export class IssueStore {
	private issues: Map<string, SyncIssue> = new Map();

	/** Record a new failure or merge into the existing one for `path`. */
	record(issue: SyncIssue): void {
		const existing = this.issues.get(issue.path);
		if (existing) {
			this.issues.set(issue.path, {
				...issue,
				firstFailedAt: existing.firstFailedAt,
				attempts: existing.attempts + 1,
			});
			return;
		}
		this.issues.set(issue.path, { ...issue });
	}

	/** Look up the current issue for `path`, if any. */
	get(path: string): SyncIssue | undefined {
		return this.issues.get(path);
	}

	/** Remove the issue for `path` (called on successful push/pull). */
	clear(path: string): void {
		this.issues.delete(path);
	}

	clearAll(): void {
		this.issues.clear();
	}

	all(): SyncIssue[] {
		return Array.from(this.issues.values());
	}

	count(category?: SyncIssueCategory): number {
		if (!category) return this.issues.size;
		let n = 0;
		for (const issue of this.issues.values()) {
			if (issue.category === category) n++;
		}
		return n;
	}

	byCategory(): Partial<Record<SyncIssueCategory, SyncIssue[]>> {
		const groups: Partial<Record<SyncIssueCategory, SyncIssue[]>> = {};
		for (const issue of this.issues.values()) {
			const bucket = groups[issue.category] ?? [];
			bucket.push(issue);
			groups[issue.category] = bucket;
		}
		return groups;
	}

	/** Plain-JSON snapshot for persistence. */
	serialize(): SyncIssue[] {
		return this.all();
	}

	/** Rebuild from persisted JSON. Tolerant of unknown/malformed input. */
	hydrate(data: unknown): void {
		this.issues.clear();
		if (!Array.isArray(data)) return;
		for (const raw of data) {
			if (!isPersistedIssue(raw)) continue;
			this.issues.set(raw.path, raw);
		}
	}
}

interface CategorizedError {
	category: SyncIssueCategory;
	status?: number;
	message: string;
	/** If true, the offline queue should NOT retry this — user action required. */
	terminal: boolean;
	/** Billing/upgrade URL when the failure is a tier limit (needs_pro). */
	upgradeUrl?: string;
}

/** Map a backend 402 `reason` to a SyncIssueCategory. Unknown reasons default
 *  to `needs_pro` (every 402 is a plan limit with an upgrade path). */
export function limitReasonToCategory(reason: string): SyncIssueCategory {
	switch (reason) {
		case "attachment_must_be_text":
		case "attachments_disabled":
			return "needs_pro";
		case "attachments_quota_exceeded":
			return "quota";
		case "file_too_large":
			return "too_large";
		// Note/vault-cap 402s come from POST /api/notes, not the attachment path.
		// Map them to the neutral `other` bucket so they aren't rendered as the
		// attachment-flavored needs_pro surface nor counted in the attachment skip
		// toast. Still terminal via categorizeError's LimitExceededError branch.
		case "notes_cap_exceeded":
		case "vaults_cap_exceeded":
			return "other";
		default:
			return "needs_pro";
	}
}

/** Classify a thrown error from a push/pull call. */
export function categorizeError(err: unknown): CategorizedError {
	// Any LimitExceededError (a 402 plan-limit) is terminal — re-pushing will
	// keep failing until the user's tier changes. Map the backend `reason` to a
	// category so the Sync Center renders the right group (e.g. "Upgrade to sync
	// attachments" for needs_pro, the storage-cap card for quota), and so the
	// push loop knows not to enqueue the file for retry.
	if (err instanceof LimitExceededError) {
		const category = limitReasonToCategory(err.reason);
		return {
			category,
			status: 402,
			message: err.message,
			terminal: true,
			upgradeUrl: err.upgradeUrl ?? undefined,
		};
	}
	const status =
		typeof err === "object" && err !== null
			? ((err as { status?: number }).status ?? undefined)
			: undefined;
	// Prefer the backend's structured error message (e.g. "failed to upload to
	// storage backend") over the bare "Request failed, status N" — the server
	// message is what makes a failure actionable in the Sync Center / a Notice.
	const message = extractServerMessage(err) ?? (err instanceof Error ? err.message : String(err));

	if (status === 413) return { category: "too_large", status, message, terminal: true };
	// 401/403 are terminal: api.ts already does a single inline refresh-and-retry on
	// 401, so a status reaching here means the credential is permanently invalid
	// (revoked key, expired session that won't refresh, wrong vault). Re-enqueueing
	// would loop forever — user must re-auth via Sync Center.
	if (status === 401 || status === 403)
		return { category: "auth", status, message, terminal: true };
	if (status !== undefined && status >= 500)
		return { category: "server", status, message, terminal: false };
	if (status === undefined) return { category: "network", message, terminal: false };
	return { category: "other", status, message, terminal: false };
}

/** Pull the backend's `error` field out of an Obsidian requestUrl rejection.
 *  The body arrives as parsed `.json` or raw `.text` depending on platform —
 *  mirror parseLimitExceededError's tolerance. Returns undefined when there's
 *  no usable string message. */
export function extractServerMessage(err: unknown): string | undefined {
	if (typeof err !== "object" || err === null) return undefined;
	const e = err as { json?: unknown; text?: string };
	let body: Record<string, unknown> | null = null;
	if (e.json && typeof e.json === "object") {
		body = e.json as Record<string, unknown>;
	} else if (typeof e.text === "string") {
		try {
			const parsed: unknown = JSON.parse(e.text);
			if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
		} catch {
			return undefined;
		}
	}
	if (body && typeof body.error === "string" && body.error.length > 0) return body.error;
	return undefined;
}

/** Whether a push/pull failure means the backend is genuinely unreachable
 *  (true connection loss) — the ONLY thing that should flip the whole plugin
 *  offline. A per-file HTTP status error (incl. 5xx like a storage 502) is that
 *  file's problem, recorded in the Sync Center; it must NOT mark us offline. */
export function shouldGoOffline(err: unknown): boolean {
	return categorizeError(err).category === "network";
}

/** Max retry attempts before a non-terminal failure is parked as
 *  needs-attention (stops the re-enqueue loop for a persistently-failing file,
 *  e.g. a broken storage backend). */
export const RETRY_CAP = 5;

/** Whether a failed push should be re-queued for retry. Terminal errors never
 *  retry; non-terminal errors retry until they hit RETRY_CAP, then park. */
export function shouldRetryAfterFailure(classified: CategorizedError, attempts: number): boolean {
	if (classified.terminal) return false;
	return attempts < RETRY_CAP;
}

/** How the Sync Center treats an issue:
 *  - `informational` — a terminal plan-limit fact (needs_pro, quota). Nothing
 *    the user can do file-by-file; surfaced for awareness with an upgrade path.
 *    Must NOT be re-enqueued for retry (retrying can't change the plan).
 *  - `actionable` — permanent until the user acts (too_large, auth, conflict).
 *    Also never auto-retried.
 *  - `transient` — clears itself via automatic retry (server, network, other).
 *  Drives the Sync Center split and the "Retry all now" filter. */
export type IssueDisposition = "informational" | "actionable" | "transient";

export function issueDisposition(category: SyncIssueCategory): IssueDisposition {
	switch (category) {
		case "needs_pro":
		case "quota":
			return "informational";
		case "too_large":
		case "auth":
		case "conflict":
			return "actionable";
		default:
			return "transient";
	}
}

/** Plain-language explanation + what-to-do for each failure category, shown on
 *  the Sync Center cards so a failure is understandable without decoding HTTP
 *  status codes. */
export function remediation(category: SyncIssueCategory): { title: string; hint: string } {
	switch (category) {
		case "needs_pro":
			return {
				title: "Attachments need a paid plan",
				hint: "The Free tier syncs notes only. Upgrade to sync images and PDFs.",
			};
		case "quota":
			return {
				title: "Attachment storage full",
				hint: "You've used all the attachment storage on your plan. Upgrade for more.",
			};
		case "too_large":
			return {
				title: "Too large for the server",
				hint: "The server limit is 5 MB. Compress or split the file, then it will sync.",
			};
		case "auth":
			return {
				title: "Sign-in expired",
				hint: "Reconnect your account to resume syncing.",
			};
		case "conflict":
			return {
				title: "Unresolved conflict",
				hint: "Open the file to resolve the conflict, then sync again.",
			};
		case "server":
			return {
				title: "Server error",
				hint: "A temporary server problem — retrying automatically.",
			};
		case "network":
			return {
				title: "Network unavailable",
				hint: "Can't reach the server — retrying automatically.",
			};
		default:
			return {
				title: "Sync failed",
				hint: "An unexpected error — retrying automatically.",
			};
	}
}

const HEALTH_CHECK_BASE_MS = 5_000;
const HEALTH_CHECK_MAX_MS = 60_000;

/** Exponential backoff for the offline health-check probe: 5s, 10s, 20s, …
 *  capped at 60s. `failures` is the count of consecutive failed probes. */
export function healthCheckDelay(failures: number): number {
	return Math.min(HEALTH_CHECK_BASE_MS * 2 ** failures, HEALTH_CHECK_MAX_MS);
}

function isPersistedIssue(value: unknown): value is SyncIssue {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.path === "string" &&
		(v.kind === "note" || v.kind === "attachment") &&
		typeof v.category === "string" &&
		typeof v.message === "string" &&
		typeof v.firstFailedAt === "number" &&
		typeof v.lastFailedAt === "number" &&
		typeof v.attempts === "number"
	);
}

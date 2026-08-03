/**
 * The `send` function for the durable CrdtOpQueue: dispatches a held CRDT op
 * (create / delete) over the current channel and maps the outcome to the
 * queue's tri-state result. Pure aside from the injected `channel()` /
 * `onCreated()` / `onTerminal()` hooks, so the error taxonomy is unit-testable
 * without a real socket.
 *
 * Error taxonomy (backend reasons from crdt_channel.ex handle_in):
 *  - resolve / server :ok            → "ok"  (delivered; queue drops it)
 *  - RETRYABLE reject                → "error" / "timeout" (queue retries):
 *      rate_limited, recently_deleted (delete-wins window), any unstructured
 *      failure (socket not joined, disconnect, network), a request timeout.
 *  - LIMIT reject                    → "error" (RETRYABLE) AND routed through
 *      onLimit so the user is TOLD via the limit toast: notes_cap_reached is a
 *      plan cap that is TRANSIENT (freeing a note / upgrading clears it), so it
 *      must retry (bounded) and self-deliver once cleared, not drop after one
 *      attempt. Surfaced once per op (the queue retries on backoff).
 *  - TERMINAL reject                 → "ok" to REMOVE it (retrying cannot help)
 *      BUT routed through onTerminal so it is logged/surfaced, never silently
 *      vanished: id_conflict, version_conflict, bad_doc_id,
 *      implausible_state_vector.
 *
 * A truly-stuck retryable/limit op is still bounded: the queue drops it after
 * MAX_ATTEMPTS (onDrop "max-attempts") or OP_TTL_MS, so nothing retries forever.
 */

import type { CrdtOp, SendResult } from "./crdt-op-queue";

/** Server reasons where a retry cannot succeed. remove the op (surfaced). */
export const TERMINAL_REASONS: ReadonlySet<string> = new Set([
	"id_conflict",
	"version_conflict",
	"bad_doc_id",
	"implausible_state_vector",
]);

/** Server reasons that are TRANSIENT plan limits: the user can clear them (free
 *  a note, upgrade). Retry (bounded) AND surface to the user, never drop after
 *  one attempt like a terminal reason. */
export const LIMIT_REASONS: ReadonlySet<string> = new Set(["notes_cap_reached"]);

/**
 * Extract the server `reason` from a sendRequest rejection. sendRequest rejects
 * with `Error("request failed: {json}")` on a server error reply; anything else
 * (timeout, "not joined", disconnect) has no structured reason → null.
 */
export function crdtOpFailureReason(err: unknown): string | null {
	const msg = err instanceof Error ? err.message : String(err);
	const m = msg.match(/request failed: (\{.*\})/s);
	if (!m?.[1]) return null;
	try {
		const reason = (JSON.parse(m[1]) as { reason?: unknown }).reason;
		return typeof reason === "string" ? reason : null;
	} catch {
		return null;
	}
}

/** The two acked socket calls the queue dispatches over. (crdt_create_batch is
 *  wired separately via `setCrdtCreateBatch`, not through this queue, so it is
 *  intentionally not a member here.) */
export type CrdtOpChannel = {
	crdtCreate(docId: string, path: string): Promise<string>;
	crdtDeleteAcked(docId: string): Promise<{ doc_id: string }>;
};

export type CrdtSendHooks = {
	/** The current channel, or null when no socket is up (→ hold + retry). */
	channel: () => CrdtOpChannel | null;
	/** A create acked: serverId is the AUTHORITATIVE id (differs on ADOPT). May
	 *  seed the body asynchronously; awaited so a queued create materializes WITH
	 *  its content, and a post-ack throw is swallowed (the row already exists). */
	onCreated: (localId: string, serverId: string, path: string) => void | Promise<void>;
	/** A terminally-failed op about to be dropped. surface it (error log). */
	onTerminal: (op: CrdtOp, reason: string) => void;
	/** A retryable PLAN-LIMIT reject (e.g. notes_cap_reached). Surface to the user
	 *  (limit toast) so they know the op is blocked; the op is still RETRIED
	 *  (bounded) so it delivers once they free a note / upgrade. */
	onLimit?: (op: CrdtOp, reason: string) => void;
};

/** Build the queue's `send`. */
export function makeCrdtOpSend(hooks: CrdtSendHooks): (op: CrdtOp) => Promise<SendResult> {
	// Surface each op's limit block ONCE: the queue retries it on backoff up to
	// MAX_ATTEMPTS, and a toast per retry would spam the user.
	const limitSurfaced = new Set<string>();
	return async (op) => {
		const ch = hooks.channel();
		if (!ch) return "error"; // no socket yet. hold and retry on the next tick
		try {
			if (op.kind === "create") {
				const path = (op.payload as { path?: string })?.path ?? "";
				const serverId = await ch.crdtCreate(op.docId, path);
				try {
					await hooks.onCreated(op.docId, serverId, path);
				} catch {
					// crdt_create already ACKED: the row exists (possibly remapped).
					// A post-ack step (body seed) throwing must NOT retry the create:
					// that would duplicate/misroute the row. The body self-heals on the
					// note's next edit.
				}
			} else if (op.kind === "delete") {
				await ch.crdtDeleteAcked(op.docId);
			} else {
				// crdt_msg is a separate task; this queue never enqueues it. Drop
				// defensively rather than retry an op kind we don't dispatch.
				limitSurfaced.delete(op.id);
				return "ok";
			}
			limitSurfaced.delete(op.id); // op resolved — drop its once-only marker
			return "ok";
		} catch (err) {
			const reason = crdtOpFailureReason(err);
			if (reason && LIMIT_REASONS.has(reason)) {
				if (!limitSurfaced.has(op.id)) {
					limitSurfaced.add(op.id);
					hooks.onLimit?.(op, reason); // tell the user, once
				}
				return "error"; // RETRYABLE (bounded): the cap clears when a note is freed
			}
			if (reason && TERMINAL_REASONS.has(reason)) {
				hooks.onTerminal(op, reason); // must not vanish; must not retry forever
				limitSurfaced.delete(op.id); // dropped — no more retries to throttle
				return "ok"; // remove from the queue
			}
			const msg = err instanceof Error ? err.message : String(err);
			return /timeout/i.test(msg) ? "timeout" : "error";
		}
	};
}

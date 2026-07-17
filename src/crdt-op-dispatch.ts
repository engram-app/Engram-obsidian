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
 *  - TERMINAL reject                 → "ok" to REMOVE it (retrying cannot help)
 *      BUT routed through onTerminal so it is logged/surfaced, never silently
 *      vanished: id_conflict, version_conflict, bad_doc_id, notes_cap_reached,
 *      implausible_state_vector.
 *
 * A truly-stuck retryable op is still bounded: the queue drops it after
 * MAX_ATTEMPTS (onDrop "max-attempts") or OP_TTL_MS, so nothing retries forever.
 */

import type { CrdtOp, SendResult } from "./crdt-op-queue";

/** Server reasons where a retry cannot succeed. remove the op (surfaced). */
export const TERMINAL_REASONS: ReadonlySet<string> = new Set([
	"id_conflict",
	"version_conflict",
	"bad_doc_id",
	"notes_cap_reached",
	"implausible_state_vector",
]);

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

/** The two acked socket calls the queue dispatches over. */
export type CrdtOpChannel = {
	crdtCreate(docId: string, path: string): Promise<string>;
	crdtDeleteAcked(docId: string): Promise<{ doc_id: string }>;
};

export type CrdtSendHooks = {
	/** The current channel, or null when no socket is up (→ hold + retry). */
	channel: () => CrdtOpChannel | null;
	/** A create acked: serverId is the AUTHORITATIVE id (differs on ADOPT). */
	onCreated: (localId: string, serverId: string, path: string) => void;
	/** A terminally-failed op about to be dropped. surface it (error log). */
	onTerminal: (op: CrdtOp, reason: string) => void;
};

/** Build the queue's `send`. */
export function makeCrdtOpSend(hooks: CrdtSendHooks): (op: CrdtOp) => Promise<SendResult> {
	return async (op) => {
		const ch = hooks.channel();
		if (!ch) return "error"; // no socket yet. hold and retry on the next tick
		try {
			if (op.kind === "create") {
				const path = (op.payload as { path?: string })?.path ?? "";
				const serverId = await ch.crdtCreate(op.docId, path);
				hooks.onCreated(op.docId, serverId, path);
			} else if (op.kind === "delete") {
				await ch.crdtDeleteAcked(op.docId);
			} else {
				// crdt_msg is a separate task; this queue never enqueues it. Drop
				// defensively rather than retry an op kind we don't dispatch.
				return "ok";
			}
			return "ok";
		} catch (err) {
			const reason = crdtOpFailureReason(err);
			if (reason && TERMINAL_REASONS.has(reason)) {
				hooks.onTerminal(op, reason); // must not vanish; must not retry forever
				return "ok"; // remove from the queue
			}
			const msg = err instanceof Error ? err.message : String(err);
			return /timeout/i.test(msg) ? "timeout" : "error";
		}
	};
}

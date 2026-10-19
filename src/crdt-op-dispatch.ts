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
 *      rate_limited, any unstructured failure (socket not joined, disconnect,
 *      network), a request timeout.
 *  - LIMIT reject                    → "error" (RETRYABLE) AND routed through
 *      onLimit so the user is TOLD via the limit toast: notes_cap_reached is a
 *      plan cap that is TRANSIENT (freeing a note / upgrading clears it), so it
 *      must retry (bounded) and self-deliver once cleared, not drop after one
 *      attempt. It also closes the shared NotesCapGate, so no other create is
 *      sent until a note is freed or the hold expires.
 *      recently_deleted moved from RETRYABLE to TERMINAL (finding 1): a
 *      delete-wins reject retried past its window resurrects the note.
 *  - TERMINAL reject                 → "ok" to REMOVE it (retrying cannot help)
 *      BUT routed through onTerminal so it is logged/surfaced, never silently
 *      vanished: id_conflict, version_conflict, bad_doc_id,
 *      implausible_state_vector.
 *
 * A truly-stuck retryable/limit op is still bounded: the queue drops it after
 * MAX_ATTEMPTS (onDrop "max-attempts") or OP_TTL_MS, so nothing retries forever.
 */

import type { GenesisOutcome } from "./channel";
import type { CrdtOp, SendResult } from "./crdt-op-queue";

/** Server reasons where a retry cannot succeed. remove the op (surfaced).
 *  recently_deleted is TERMINAL for creates (review finding 1): the path was
 *  deleted on another device inside the delete-wins window — retrying past the
 *  window would RESURRECT the note everywhere. The local copy converges via
 *  the tombstone on the next catch-up replay. */
export const TERMINAL_REASONS: ReadonlySet<string> = new Set([
	"id_conflict",
	"version_conflict",
	"bad_doc_id",
	"implausible_state_vector",
	"recently_deleted",
]);

/** Server reasons that are TRANSIENT plan limits: the user can clear them (free
 *  a note, upgrade). Retry (bounded) AND surface to the user, never drop after
 *  one attempt like a terminal reason. */
export const LIMIT_REASONS: ReadonlySet<string> = new Set(["notes_cap_reached"]);

/** How long one notes_cap_reached reject pauses EVERY create. */
export const NOTES_CAP_HOLD_MS = 10 * 60 * 1000;

/**
 * Vault-wide breaker for the plan note cap. The cap belongs to the ACCOUNT, not
 * the op: once one create is refused, every create will be until a note is freed
 * or the plan changes. Without a shared gate each create rediscovered the cap on
 * its own and retried it, so a vault over the cap hammered the server for as long
 * as Obsidian stayed open (prod 2026-10-17: a 10k+ note first sync pinned web).
 *
 * Closes on a cap reject. Reopens on a delete ack (a note was freed) or after
 * `holdMs`, which covers a delete on another device: the next create is the
 * probe, and a fresh reject closes it again. `reset()` (plan change, vault
 * switch, auth swap) reopens it at once.
 *
 * The user is told when the cap is first hit and again after notes were freed
 * (`open`/`reset`), but not on the expiry probe: the self-heal sweep probes
 * every few minutes for as long as the vault stays over the cap.
 */
export class NotesCapGate {
	private closedUntil = 0;
	private notified = false;

	constructor(
		private readonly now: () => number,
		private readonly onTrip?: (reason: string) => void,
		private readonly holdMs = NOTES_CAP_HOLD_MS,
	) {}

	isClosed(): boolean {
		return this.now() < this.closedUntil;
	}

	trip(reason: string): void {
		this.closedUntil = this.now() + this.holdMs;
		if (this.notified) return;
		this.notified = true;
		this.onTrip?.(reason);
	}

	open(): void {
		this.closedUntil = 0;
		this.notified = false;
	}

	reset(): void {
		this.closedUntil = 0;
		this.notified = false;
	}
}

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
	crdtCreate(
		docId: string,
		path: string,
		b64?: string,
	): Promise<{ docId: string; seeded: boolean; genesisOutcome: GenesisOutcome }>;
	crdtDeleteAcked(docId: string): Promise<{ doc_id: string }>;
};

/** The bytes a genesis frame was built from, kept alongside the wire frame so
 *  a `seeded: true` reply can apply the EXACT SAME update locally (review
 *  H4) instead of re-deriving it — a second `encodeGenesisUpdate` call mints
 *  a DIFFERENT throwaway Y.Doc/clientID, which would be a causally
 *  UNRELATED lineage to what the server actually stored, not an equivalent
 *  one: any future incremental edit built against one could not integrate
 *  into the other (its origin pointers reference ops the receiving doc has
 *  never seen), risking the exact corruption class this fix exists to
 *  prevent, just deferred to the note's next real edit instead of its
 *  create. */
export type GenesisFrame = { b64: string; update: Uint8Array; content: string };

export type CrdtSendHooks = {
	/** The current channel, or null when no socket is up (→ hold + retry). */
	channel: () => CrdtOpChannel | null;
	/** #1409 (review H4): build the genesis body for a create op, called right
	 *  before `crdtCreate`. Re-reads disk AT SEND TIME rather than trusting a
	 *  snapshot captured when the op was originally enqueued — a queued create
	 *  can replay much later (rate-limit backoff, a long reconnect), and
	 *  persisting the body into the op itself would bloat the (IndexedDB-
	 *  backed) queue with content that's stale by the time it matters.
	 *  Returns undefined when the note doesn't qualify (canvas, live-bound,
	 *  oversized, gone, unreadable) or CRDT is unset — the create still
	 *  sends, just without a body; `onCreated`'s existing disk-seed path
	 *  delivers it instead, exactly like before this fix. Optional so a
	 *  caller/test that never wires it keeps the old bodyless-create
	 *  behaviour.
	 *
	 *  `noteId` is the id the create will actually be made under (`op.docId`) —
	 *  NOT re-derived from `path` inside. The frame's safety gate asks "does this
	 *  device already hold lineage for this note", and asking that about a
	 *  DIFFERENT id than the one being created is the doubling bug wearing a
	 *  disguise: a rename or id-map reconcile between enqueue and replay makes
	 *  `map.get(path)` disagree with `op.docId`, and the gate would then clear a
	 *  note whose real doc has history. */
	buildGenesisFrame?: (path: string, noteId: string) => Promise<GenesisFrame | undefined>;
	/** A create acked: serverId is the AUTHORITATIVE id (differs on ADOPT).
	 *  `genesisOutcome` says what the server DID with the frame — the caller must
	 *  not decide whether to transmit a body from `seeded` alone (#476).
	 *  `seeded` + `genesis` (present only when a frame was actually sent) let
	 *  the caller apply the SAME bytes locally instead of re-seeding from
	 *  disk over crdt_msg — which would open the very room #1409 exists to
	 *  avoid — mirroring pushFile's own seeded-gated local apply. May seed
	 *  the body asynchronously; awaited so a queued create materializes WITH
	 *  its content, and a post-ack throw is swallowed (the row already
	 *  exists). */
	onCreated: (
		localId: string,
		serverId: string,
		path: string,
		seeded: boolean,
		genesis?: GenesisFrame,
		genesisOutcome?: GenesisOutcome,
	) => void | Promise<void>;
	/** A post-ack step (`onCreated`) threw. The create is NOT retried — the row
	 *  already exists — but the failure must be visible: that same step confirms
	 *  the id and flushes edits held by the `canSendLive` gate, so a silent
	 *  throw strands keystrokes the user already typed. */
	onPostAckError?: (docId: string, path: string, error: unknown) => void;
	/** Bracket a create's whole send-to-ack round trip, so catch-up does not
	 *  read the note's own pre-create disk bytes as a local edit (SyncEngine
	 *  `creatingPaths`). `endCreate` runs on every exit. */
	beginCreate?: (path: string) => void;
	endCreate?: (path: string) => Promise<void>;
	/** A terminally-failed op about to be dropped. surface it (error log). */
	onTerminal: (op: CrdtOp, reason: string) => void;
	/** A retryable PLAN-LIMIT reject (e.g. notes_cap_reached). Surface to the user
	 *  (limit toast) so they know the op is blocked; the op is still RETRIED
	 *  (bounded) so it delivers once they free a note / upgrade. */
	onLimit?: (op: CrdtOp, reason: string) => void;
	/** Shared with the push path. A cap reject closes it and a delete ack
	 *  reopens it. Blocking is decided by `capBlocksCreate`, not here. */
	capGate?: NotesCapGate;
	/** Whether the cap blocks a create for this path. Only a row-adding create
	 *  is blocked: a queued RENAME of a synced note relocates its row and must
	 *  still go out. Production wires `SyncEngine.capBlocksCreate`. */
	capBlocksCreate?: (path: string) => boolean;
};

/** Build the queue's `send`. */
export function makeCrdtOpSend(hooks: CrdtSendHooks): (op: CrdtOp) => Promise<SendResult> {
	// Surface each op's limit block ONCE: the queue retries it on backoff up to
	// MAX_ATTEMPTS, and a toast per retry would spam the user.
	const limitSurfaced = new Set<string>();
	return async (op) => {
		const ch = hooks.channel();
		if (!ch) return "error"; // no socket yet. hold and retry on the next tick
		const path = (op.payload as { path?: string })?.path ?? "";
		// The account is at its note cap: the server would refuse this create too.
		if (op.kind === "create" && hooks.capBlocksCreate?.(path)) return "held";
		try {
			if (op.kind === "create") {
				hooks.beginCreate?.(path);
				try {
					const genesis = await hooks.buildGenesisFrame?.(path, op.docId);
					const {
						docId: serverId,
						seeded,
						genesisOutcome,
					} = genesis
						? await ch.crdtCreate(op.docId, path, genesis.b64)
						: await ch.crdtCreate(op.docId, path);
					try {
						await hooks.onCreated(
							op.docId,
							serverId,
							path,
							seeded,
							genesis,
							genesisOutcome,
						);
					} catch (e) {
						// crdt_create already ACKED: the row exists (possibly remapped).
						// A post-ack step throwing must NOT retry the create — that would
						// duplicate/misroute the row.
						//
						// It must not be SILENT either. `onCreated` also runs
						// `adoptCreateAck`, which sets the id map, flips the
						// has-server-note oracle, confirms the id, and flushes edits held
						// by the `canSendLive` gate. A throw loses all of that, including
						// keystrokes the user already typed, and the bare `catch {}` wrote
						// nothing anywhere — unobservable by construction (#1409 review).
						hooks.onPostAckError?.(op.docId, path, e);
					}
				} finally {
					await hooks.endCreate?.(path);
				}
			} else if (op.kind === "delete") {
				await ch.crdtDeleteAcked(op.docId);
				hooks.capGate?.open(); // a note was freed, so a create may fit again
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
				hooks.capGate?.trip(reason);
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

/**
 * CrdtEnrollment — per-note `startSync` enrollment tracker.
 *
 * Calls `CrdtChannel.startSync(noteId)` exactly once per note_id per channel
 * session so the state-vector handshake fires and the note pulls remote CRDT
 * state (the down-sync gap). Without enrollment, an opened note only pushes
 * local edits; it never receives server-side history.
 *
 * Task 6 (note_id-keyed CRDT rework): this tracker is keyed by note_id, not
 * path — a `crdt_doc_ready` announce or an inbound `crdt_msg` carries a bare
 * note_id with no path embedded, so `enroll`/`reset` can no longer assume a
 * path-shaped string. The markdown-only gate (CRDT manages `.md` notes only)
 * moved OUT of this class and into every call site instead, where the path is
 * still known (`handleModify`/routing time, `active-leaf-change`, etc.). A
 * caller reacting to a `crdt_doc_ready`/`crdt_msg` announce has no path to
 * check at all (and doesn't need one — the backend only ever opens CRDT rooms
 * for markdown notes), so those call sites enroll unconditionally.
 *
 * Usage in main.ts:
 *   - Create one `CrdtEnrollment` per `CrdtChannel` instance (recreated on each
 *     `setupNoteStream()` call).
 *   - Call `enroll(noteId)` from the `workspace.on('active-leaf-change')` handler
 *     for any markdown file that becomes active (after resolving noteId).
 *   - Call `reset(noteId)` from the channel `onStatusChange` reconnect path so a
 *     fresh handshake fires after a disconnect (mirrors `CrdtChannel.resetSync`).
 */

import { errMsg } from "../error-util";
import { rlog } from "../remote-log";

export class CrdtEnrollment {
	/** note_ids that have already received (or been queued for) a startSync this session. */
	private readonly enrolled = new Set<string>();
	/** FIFO of note_ids awaiting their startSync handshake (bounded fan-out). */
	private readonly queue: string[] = [];
	/** startSync handshakes currently in flight. */
	private active = 0;
	private readonly concurrency: number;

	private readonly startSync: (noteId: string) => Promise<void>;
	private readonly resetSync: (noteId: string) => void;
	/**
	 * Optional post-enroll hook: called once after `startSync` resolves for a
	 * note_id. Wired to `CrdtManager.flattenIfBloated` so a bloated doc is
	 * compacted on open. It is a no-op below the AND threshold (≥500 KB AND
	 * ≥1000 client-IDs), so the cost on normal docs is negligible.
	 */
	private readonly onAfterEnroll?: (noteId: string) => Promise<void>;

	constructor(opts: {
		startSync: (noteId: string) => Promise<void>;
		resetSync: (noteId: string) => void;
		/** Called once after startSync resolves — wire to flattenIfBloated. */
		onAfterEnroll?: (noteId: string) => Promise<void>;
		/** Max concurrent STEP1 handshakes. Bounds the connect fan-out so a large
		 *  vault does not storm the backend with N simultaneous room joins. */
		concurrency?: number;
	}) {
		this.startSync = opts.startSync;
		this.resetSync = opts.resetSync;
		this.onAfterEnroll = opts.onAfterEnroll;
		this.concurrency = opts.concurrency ?? 4;
	}

	/**
	 * Enroll `noteId` if it hasn't been enrolled this session. Calling multiple
	 * times for the same note_id is idempotent — `startSync` fires exactly once,
	 * followed by `onAfterEnroll` (if provided) so bloat compaction runs on open.
	 *
	 * `startSync` fan-out is bounded to `concurrency` in-flight handshakes at
	 * once (fix for the connect storm on large-vault open) — every note still
	 * enrolls, just queued FIFO behind the cap instead of all firing at once.
	 *
	 * No markdown/extension gate here (see class doc) — callers that know the
	 * path (routing/open-file sites) must check `.md` themselves before calling;
	 * callers reacting to a bare-id wire announce enroll unconditionally.
	 */
	enroll(noteId: string): void {
		if (this.enrolled.has(noteId)) return;
		this.enrolled.add(noteId);
		this.queue.push(noteId);
		this.drain();
	}

	private drain(): void {
		while (this.active < this.concurrency && this.queue.length > 0) {
			const noteId = this.queue.shift() as string;
			this.active++;
			void this.startSync(noteId)
				.then(() => this.onAfterEnroll?.(noteId))
				.catch((e) => {
					// Failed handshake: un-mark so a later enroll() retries — a
					// permanent `enrolled` latch would leave the note deaf to remote
					// CRDT state for the whole session, with nothing logged.
					// resetSync clears the channel's once-per-doc `initiated` latch
					// too (set BEFORE startSync's first await) — without it the
					// retry's startSync early-returns and never sends a STEP1.
					this.enrolled.delete(noteId);
					this.resetSync(noteId);
					rlog().warn(
						"crdt",
						`enroll startSync failed for ${noteId}: ${errMsg(e)} — will retry on next open`,
					);
				})
				.finally(() => {
					this.active--;
					this.drain();
				});
		}
	}

	/**
	 * Clear the enrollment record for `noteId` and call `resetSync` on the
	 * channel so the once-per-doc guard is also lifted. Call on channel
	 * reconnect so the state-vector handshake re-fires with fresh server state.
	 */
	reset(noteId: string): void {
		this.enrolled.delete(noteId);
		// Drop it from the queue too, so a reset-before-handshake note is not
		// later handshaked against stale server state.
		const i = this.queue.indexOf(noteId);
		if (i !== -1) this.queue.splice(i, 1);
		this.resetSync(noteId);
	}

	/** Clear all enrollments (use when the channel is torn down). */
	resetAll(): void {
		this.queue.length = 0;
		for (const noteId of this.enrolled) {
			this.resetSync(noteId);
		}
		this.enrolled.clear();
	}
}

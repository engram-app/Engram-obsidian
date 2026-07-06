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

export class CrdtEnrollment {
	/** note_ids that have already received a `startSync` call this session. */
	private readonly enrolled = new Set<string>();

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
	}) {
		this.startSync = opts.startSync;
		this.resetSync = opts.resetSync;
		this.onAfterEnroll = opts.onAfterEnroll;
	}

	/**
	 * Enroll `noteId` if it hasn't been enrolled this session. Calling multiple
	 * times for the same note_id is idempotent — `startSync` fires exactly once,
	 * followed by `onAfterEnroll` (if provided) so bloat compaction runs on open.
	 *
	 * No markdown/extension gate here (see class doc) — callers that know the
	 * path (routing/open-file sites) must check `.md` themselves before calling;
	 * callers reacting to a bare-id wire announce enroll unconditionally.
	 */
	enroll(noteId: string): void {
		if (this.enrolled.has(noteId)) return;
		this.enrolled.add(noteId);
		void this.startSync(noteId).then(() => this.onAfterEnroll?.(noteId));
	}

	/**
	 * Clear the enrollment record for `noteId` and call `resetSync` on the
	 * channel so the once-per-doc guard is also lifted. Call on channel
	 * reconnect so the state-vector handshake re-fires with fresh server state.
	 */
	reset(noteId: string): void {
		this.enrolled.delete(noteId);
		this.resetSync(noteId);
	}

	/** Clear all enrollments (use when the channel is torn down). */
	resetAll(): void {
		for (const noteId of this.enrolled) {
			this.resetSync(noteId);
		}
		this.enrolled.clear();
	}
}

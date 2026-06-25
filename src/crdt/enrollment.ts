/**
 * CrdtEnrollment — per-note `startSync` enrollment tracker.
 *
 * Calls `CrdtChannel.startSync(path)` exactly once per path per channel session
 * so the state-vector handshake fires and the note pulls remote CRDT state (the
 * down-sync gap). Without enrollment, an opened note only pushes local edits;
 * it never receives server-side history.
 *
 * Usage in main.ts:
 *   - Create one `CrdtEnrollment` per `CrdtChannel` instance (recreated on each
 *     `setupNoteStream()` call).
 *   - Call `enroll(path)` from the `workspace.on('active-leaf-change')` handler
 *     for any markdown file that becomes active.
 *   - Call `reset(path)` from the channel `onStatusChange` reconnect path so a
 *     fresh handshake fires after a disconnect (mirrors `CrdtChannel.resetSync`).
 */
export class CrdtEnrollment {
	/** Paths that have already received a `startSync` call this session. */
	private readonly enrolled = new Set<string>();

	private readonly startSync: (path: string) => Promise<void>;
	private readonly resetSync: (path: string) => void;

	constructor(opts: {
		startSync: (path: string) => Promise<void>;
		resetSync: (path: string) => void;
	}) {
		this.startSync = opts.startSync;
		this.resetSync = opts.resetSync;
	}

	/**
	 * Enroll `path` if it hasn't been enrolled this session. Calling multiple
	 * times for the same path is idempotent — `startSync` fires exactly once.
	 */
	enroll(path: string): void {
		if (this.enrolled.has(path)) return;
		this.enrolled.add(path);
		void this.startSync(path);
	}

	/**
	 * Clear the enrollment record for `path` and call `resetSync` on the channel
	 * so the once-per-doc guard is also lifted. Call on channel reconnect so the
	 * state-vector handshake re-fires with fresh server state.
	 */
	reset(path: string): void {
		this.enrolled.delete(path);
		this.resetSync(path);
	}

	/** Clear all enrollments (use when the channel is torn down). */
	resetAll(): void {
		for (const path of this.enrolled) {
			this.resetSync(path);
		}
		this.enrolled.clear();
	}
}

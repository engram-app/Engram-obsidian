/**
 * Ordered capture of what happened at the CRDT sync seams.
 *
 * Ported from Relay (`src/merge-hsm/recording/`). The gap it closes: a sync
 * failure that only reproduces in CI is currently un-unit-testable. With a
 * timeline it becomes download → replay in Bun → fix → keep the timeline as a
 * regression fixture.
 *
 * **`seq` is a monotonic counter, never a clock reading.** This is the whole
 * point. Our `[client:*]` log `time` is the batch-SHIP stamp, so ordering by it
 * scrambles causality — a trap that cost two debugging sessions. A recorded
 * timeline is ordered by construction and `deserializeTimeline` refuses to load
 * one whose ordering was broken.
 *
 * ponytail: the recorder ships; the REPLAYER lives in `tests/helpers/replay.ts`.
 * Capture is the half we cannot do at all today, and it has to run inside a
 * user's session. Replay is a test-harness concern and has no business in the
 * production bundle.
 */

/** Seams worth recording. Kept as a closed union so a replayer can exhaustively
 *  switch and a new seam cannot be added without teaching replay about it. */
export type SyncEventKind =
	/** Inbound CRDT frame from the wire. */
	| "receive"
	/** Outbound CRDT frame. `accepted:false` means the transport refused it. */
	| "send"
	/** Disk content fed into the doc. */
	| "localEdit"
	/** Raw Yjs update applied outside the room handshake (vault fan-out). */
	| "remoteUpdate"
	/** Room opened (syncStep1 advertised). */
	| "enroll"
	/** Room closed. */
	| "reset"
	/** Transport connected or dropped. */
	| "connection"
	/** A remote merge was written back to disk. */
	| "flush";

/** Runtime companion to `SyncEventKind`. Kept adjacent to the type so adding a
 *  kind without listing it here shows up immediately as a load-time rejection
 *  rather than an unhandled `default` branch deep in a replay. */
const SYNC_EVENT_KINDS = new Set<string>([
	"receive",
	"send",
	"localEdit",
	"remoteUpdate",
	"enroll",
	"reset",
	"connection",
	"flush",
] satisfies SyncEventKind[]);

function isSyncEventKind(value: string): value is SyncEventKind {
	return SYNC_EVENT_KINDS.has(value);
}

export interface SyncEvent {
	/** Monotonic, assigned at record time. Never a timestamp. */
	seq: number;
	kind: SyncEventKind;
	/** The note this event concerns, or null for vault-wide events. */
	noteId: string | null;
	/** Kind-specific payload. Must be JSON-serializable. */
	data: Record<string, unknown>;
}

export interface SyncRecorderOpts {
	/** Read at every record call, so toggling the flag takes effect immediately
	 *  rather than at the next reload. */
	enabled: () => boolean;
	capacity?: number;
}

const DEFAULT_CAPACITY = 5_000;

export class SyncRecorder {
	private readonly events: SyncEvent[] = [];
	private readonly capacity: number;
	private readonly enabled: () => boolean;
	private nextSeq = 0;

	constructor(opts: SyncRecorderOpts) {
		this.enabled = opts.enabled;
		this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
	}

	/**
	 * Append one event.
	 *
	 * When recording is off this is a bare predicate call and a return — cheap
	 * enough to sit on the hot receive path. `nextSeq` deliberately does NOT
	 * advance for a suppressed event: a timeline captured across a mid-session
	 * toggle would otherwise show numbering gaps that read as dropped frames.
	 */
	record(kind: SyncEventKind, noteId: string | null, data: Record<string, unknown>): void {
		if (!this.enabled()) return;
		this.events.push({ seq: this.nextSeq++, kind, noteId, data });
		if (this.events.length > this.capacity) {
			this.events.splice(0, this.events.length - this.capacity);
		}
	}

	/** Recorded events in causal order, optionally narrowed to one note. The
	 *  retained window keeps its original seq numbers, so a truncated timeline
	 *  still reports how much preceded it. */
	timeline(noteId?: string): SyncEvent[] {
		const all = [...this.events];
		return noteId ? all.filter((e) => e.noteId === noteId) : all;
	}

	/** Drop buffered events. The seq counter keeps going: restarting numbering
	 *  would make two timelines from one session look like the same events. */
	clear(): void {
		this.events.length = 0;
	}
}

export function serializeTimeline(events: SyncEvent[]): string {
	return JSON.stringify(events);
}

/**
 * Parse a timeline, rejecting anything that would replay misleadingly.
 *
 * Validation is not defensive padding here: a fixture gets hand-edited and
 * badly merged, and a timeline replayed out of causal order produces a
 * divergence with no obvious cause. Failing loudly at load is much cheaper than
 * debugging that.
 */
export function deserializeTimeline(json: string): SyncEvent[] {
	const parsed: unknown = JSON.parse(json);
	if (!Array.isArray(parsed)) {
		throw new Error("timeline must be an array");
	}

	let previousSeq = Number.NEGATIVE_INFINITY;
	return parsed.map((raw, index) => {
		// Read through `unknown`, not `Partial<SyncEvent>`. Asserting the shape up
		// front makes `kind` LOOK like the union to the compiler while the runtime
		// value is still an arbitrary string, so an unknown kind would sail through
		// validation and reach a replayer that promises to switch exhaustively.
		const e = raw as Record<string, unknown>;
		if (
			typeof e.seq !== "number" ||
			typeof e.kind !== "string" ||
			typeof e.data !== "object" ||
			e.data === null
		) {
			throw new Error(`timeline entry ${index} is missing seq, kind or data`);
		}
		if (!isSyncEventKind(e.kind)) {
			throw new Error(`timeline entry ${index} has unknown kind ${JSON.stringify(e.kind)}`);
		}
		if (e.seq <= previousSeq) {
			throw new Error(
				`timeline is out of order at entry ${index}: seq ${e.seq} follows ${previousSeq}`,
			);
		}
		previousSeq = e.seq;
		return {
			seq: e.seq,
			kind: e.kind,
			noteId: typeof e.noteId === "string" ? e.noteId : null,
			data: (e.data ?? {}) as Record<string, unknown>,
		};
	});
}

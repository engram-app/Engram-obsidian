import { errMsg } from "../error-util";
import { rlog } from "../remote-log";
import type { SyncEngine } from "../sync";
import { CrdtChannel } from "./channel";
import { CrdtEnrollment } from "./enrollment";
import { CrdtManager } from "./manager";
import type { NoteIdMap } from "./note-id-map";

/** SyncEngine members the CRDT wiring actually touches. Structural so tests can
 *  pass a lightweight fake without standing up the whole engine. */
type WiringSyncEngine = Pick<
	SyncEngine,
	| "flushFromCrdt"
	| "isUnchangedSynced"
	| "materializeEmptyDiscovered"
	| "reconcileNoteIdMapFromManifest"
	| "isSyncBlocked"
>;

export interface CrdtWiringDeps {
	/** Path <-> note_id sidecar. The wire is id-keyed; disk I/O is path-keyed,
	 *  so every callback resolves id -> path through `pathForId`. */
	noteIdMap: NoteIdMap;
	syncEngine: WiringSyncEngine;
	/** Outbound transport for CRDT frames (the note WS channel's `sendCrdt`).
	 *  Return value (P1: a delivered/dropped boolean) is ignored by the codec. */
	sendCrdt: (docId: string, frame: string) => unknown;
	/** True when a live editor binding owns `path` on disk — flushes skip it so
	 *  the binding stays authoritative. Backed lazily by CrdtLiveViews (which is
	 *  constructed after this wiring), so it must be a closure, not a value. */
	isBound: (path: string) => boolean;
	/** Debounce before a stranded-flush batch reconciles + retries. */
	strandHealDebounceMs?: number;
	/** IndexedDB store namespace (CrdtManagerOptions.dbPrefix). Production omits
	 *  it — each real device has its own browser origin. Set only by tests that
	 *  run two "devices" against one shared fake-indexeddb process. */
	dbPrefix?: string;
}

export interface CrdtWiring {
	manager: CrdtManager;
	channel: CrdtChannel;
	enrollment: CrdtEnrollment;
	/** Inbound CRDT frame handler (channel.onCrdtMessage). */
	onCrdtMessage: (docId: string, b64: string) => void;
	/** Remote room-open announce handler (channel.onCrdtDocReady). */
	onCrdtDocReady: (docId: string) => void;
	/** Reconcile the noteIdMap from the manifest, then retry every stranded
	 *  flush. Exposed for tests + teardown; production fires it via the debounce
	 *  timer set in the manager's onFlushToDisk. */
	drainStrandedFlushes: () => Promise<void>;
	/** Clear the pending strand-heal timer (call from the plugin's onunload). */
	dispose: () => void;
}

const DEFAULT_STRAND_HEAL_DEBOUNCE_MS = 750;

/**
 * Build the CRDT data-plane glue that used to live inline in main.ts: the
 * CrdtManager / CrdtChannel / CrdtEnrollment trio with their id -> path
 * resolving callbacks, the two channel handlers (`onCrdtMessage`,
 * `onCrdtDocReady`), and the stranded-flush self-heal (#187).
 *
 * Kept OUT of here (they stay in main.ts) because they touch Obsidian or
 * plugin-lifecycle state, not the keying/CRDT layer:
 *   - CrdtLiveViews (app + workspace) — reached via the `isBound` closure;
 *   - `onCrdtJoined` / `onCrdtJoinError` — set plugin flags + show Notices +
 *     call reEnrollOpenCrdtNotes; they delegate the manager activation to
 *     `syncEngine.setCrdtManager(wiring.manager)`;
 *   - the connect/disconnect reconcile in `onStatusChange` — per-session flags
 *     + catch-up pull.
 */
export function createCrdtWiring(deps: CrdtWiringDeps): CrdtWiring {
	const { noteIdMap, syncEngine } = deps;
	const debounceMs = deps.strandHealDebounceMs ?? DEFAULT_STRAND_HEAL_DEBOUNCE_MS;

	// Latest content per stranded id (unknown id -> no disk path), coalesced so a
	// burst of stranded flushes shares ONE reconcile.
	const strandedFlushes = new Map<string, string>();
	let strandHealTimer: number | null = null;

	async function drainStrandedFlushes(): Promise<void> {
		const pending = new Map(strandedFlushes);
		strandedFlushes.clear();
		try {
			await syncEngine.reconcileNoteIdMapFromManifest();
		} catch (e) {
			rlog().warn("crdt", `strand-heal reconcile failed: ${errMsg(e)}`);
		}
		for (const [id, content] of pending) {
			const path = noteIdMap.pathForId(id);
			if (!path) {
				rlog().warn(
					"crdt",
					`onFlushToDisk: still no path for note_id=${id} after heal — retained in Y.Doc`,
				);
				continue;
			}
			if (deps.isBound(path)) continue; // live editor owns disk
			void syncEngine.flushFromCrdt(path, content);
		}
	}

	/** Re-resolve a stranded inbound CRDT note (unknown id -> no disk path) by
	 *  reconciling the noteIdMap from the server manifest, then retrying the
	 *  flush. Debounced so a burst of stranded flushes shares ONE reconcile.
	 *  Self-heals a mid-session map drift the once-per-connect reconcile misses. */
	function healUnknownNoteId(noteId: string, content: string): void {
		strandedFlushes.set(noteId, content); // keep the latest content per id
		if (strandHealTimer !== null) return;
		strandHealTimer = window.setTimeout(() => {
			strandHealTimer = null;
			void drainStrandedFlushes();
		}, debounceMs);
	}

	// Box pattern: the manager's onUpdate references the channel, and the channel
	// references the manager — a construction cycle main.ts breaks with a `this.`
	// field read. Mirror that with a lazily-filled box.
	const box = { channel: null as unknown as CrdtChannel };

	// note_id-keyed CRDT (Task 6): docId on the wire is the bare note_id. Disk
	// I/O is still path-keyed, so every callback resolves the path via noteIdMap.
	const manager = new CrdtManager({
		dbPrefix: deps.dbPrefix,
		onUpdate: (docId, update) => box.channel.sendUpdateRaw(docId, update),
		onFlushToDisk: (noteId, content) => {
			const path = noteIdMap.pathForId(noteId);
			if (!path) {
				// Unknown id: a crdt_msg/STEP2 arrived for a note this device hasn't
				// learned a path for yet. Content is safe in the Y.Doc meanwhile;
				// healUnknownNoteId re-resolves the id from the manifest and retries so
				// a drift self-heals instead of stranding forever.
				healUnknownNoteId(noteId, content);
				return Promise.resolve();
			}
			return deps.isBound(path) ? Promise.resolve() : syncEngine.flushFromCrdt(path, content);
		},
		// Adopt-first seed gate: never re-encode content the server already holds.
		isUnchangedSynced: (noteId, content) => {
			const path = noteIdMap.pathForId(noteId);
			return path ? syncEngine.isUnchangedSynced(path, content) : false;
		},
		onPersistError: (noteId, err) => {
			const path = noteIdMap.pathForId(noteId) ?? noteId;
			rlog().warn(
				"crdt",
				`IndexedDB persist error for ${path} — sync continues in-memory: ${errMsg(err)}`,
			);
		},
	});

	const channel = new CrdtChannel({
		manager,
		send: (docId, frame) => deps.sendCrdt(docId, frame),
		// An inbound STEP2 that leaves the doc empty is the server's authoritative
		// "genuinely empty note" signal — materialize the file off the handshake
		// (not a timer) so a slow content STEP2 can never race a premature empty
		// file onto disk (#547).
		onEmptyStep2: (noteId) => {
			const path = noteIdMap.pathForId(noteId);
			if (!path) {
				rlog().warn(
					"crdt",
					`onEmptyStep2: no known path for note_id=${noteId} — skipping materialize`,
				);
				return;
			}
			void syncEngine.materializeEmptyDiscovered(path, noteId);
		},
	});
	box.channel = channel;

	// Enrollment tracker: calls startSync(noteId) exactly once per note per
	// channel session so the state-vector handshake fires and the note pulls
	// remote CRDT state (the down-sync gap).
	const enrollment = new CrdtEnrollment({
		startSync: (noteId) => channel.startSync(noteId),
		resetSync: (noteId) => channel.resetSync(noteId),
		// After the handshake fires, compact any bloated docs. No-op below the AND
		// threshold (>=500 KB and >=1000 client-IDs), safe to run on every open.
		onAfterEnroll: async (noteId) => {
			await manager.flattenIfBloated(noteId);
		},
	});

	// docId is the bare note_id (Task 6) — forwarded to handleFrame directly.
	const onCrdtMessage = (docId: string, b64: string): void => {
		void channel.handleFrame(docId, b64);
	};

	// Discovery: when another device opens a room (server announces
	// crdt_doc_ready), enroll the note here so a sync-step-1 fires and we pull it
	// even if we've never opened it.
	const onCrdtDocReady = (docId: string): void => {
		// While the sync gate is closed, skip enrollment: STEP2 ops would integrate
		// into the Y.Doc but never flush, and after gate-accept the re-handshake
		// delivers zero new ops. Gating here keeps gated-period state out of the doc
		// entirely; the announce re-fires via pull discovery once the gate opens.
		if (syncEngine.isSyncBlocked()) return;
		enrollment.enroll(docId);
	};

	function dispose(): void {
		if (strandHealTimer !== null) {
			window.clearTimeout(strandHealTimer);
			strandHealTimer = null;
		}
	}

	return {
		manager,
		channel,
		enrollment,
		onCrdtMessage,
		onCrdtDocReady,
		drainStrandedFlushes,
		dispose,
	};
}

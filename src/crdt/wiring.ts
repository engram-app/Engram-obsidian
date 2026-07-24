import { errMsg } from "../error-util";
import { rlog } from "../remote-log";
import type { SyncEngine } from "../sync";
import { CrdtChannel, fromB64 } from "./channel";
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
	| "ensureNoteIdMapped"
	| "applyPushedNoteUpdate"
	| "discoverAnnouncedNote"
	| "applyLiveOpWithSeq"
	| "commitCrdtConvergence"
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
	/** Fix wave 6: called whenever a remote-merge flush is skipped BECAUSE
	 *  `path` is bound (i.e. right where the editor binding painted the
	 *  update instead of a disk write). Headless/unfocused Obsidian (CI)
	 *  doesn't promptly flush a programmatically-updated editor buffer to
	 *  disk on its own — this is the nudge: the caller (main.ts, which HAS
	 *  Obsidian API access — this file deliberately doesn't) requests
	 *  Obsidian's own save pipeline for the bound view, debounced. Optional;
	 *  omitted in tests that don't exercise it. Never throws (the caller's
	 *  contract, not enforced here). */
	onBoundUpdate?: (path: string) => void;
	/** True once `noteId`'s crdt_create has been server-acked (its DB row
	 *  exists) — CrdtManagerOptions.canSendLive. A brand-new note's live edits
	 *  land in the Y.Doc immediately (never lost) but must NOT stream a
	 *  crdt_msg before the row exists: the server silently drops it
	 *  (note_not_found). Omitted in tests defaults to always-send (matches
	 *  pre-gate behavior). */
	canSendLive?: (noteId: string) => boolean;
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
	/** Remote room-open announce handler (channel.onCrdtDocReady). `path` is
	 *  carried on the announce (backend addition) so an empty note can be
	 *  discovered immediately; absent on pre-path backends. */
	onCrdtDocReady: (docId: string, path?: string) => void;
	/** Server dropped a crdt_msg we sent for an unknown note_id (backend #955,
	 *  plugin #202) — the create-race cross-wire signature. Handler kicks the
	 *  sync engine's coalesced live id-map reconcile (channel.onCrdtNoteNotFound). */
	onCrdtNoteNotFound: (docId: string) => void;
	/** Server-pushed Yjs update for an IDLE note, fanned out over the per-vault
	 *  channel regardless of CRDT-room enrollment (channel.onNoteYjsUpdate).
	 *  `seq` (Phase D2 gap-heal, Task 3) routes through
	 *  SyncEngine.applyLiveOpWithSeq — see its definition for the decision. */
	onNoteYjsUpdate: (noteId: string, b64: string, head: string, seq?: number | null) => void;
	/** Reconcile the noteIdMap from the manifest, then retry every stranded
	 *  flush. Exposed for tests + teardown; production fires it via the debounce
	 *  timer set in the manager's onFlushToDisk. */
	drainStrandedFlushes: () => Promise<void>;
	/** Reset per-id strand-heal retry counters. Call when the noteIdMap was just
	 *  reconciled wholesale (reconnect) — stranded ids deserve fresh attempts
	 *  against the now-current map, not counters left over from before the drift
	 *  was fixed (final review MINOR-6). */
	clearStrandHealAttempts: () => void;
	/** Clear the pending strand-heal timer (call from the plugin's onunload). */
	dispose: () => void;
}

const DEFAULT_STRAND_HEAL_DEBOUNCE_MS = 750;
const STRAND_HEAL_MAX_ATTEMPTS = 5;

/** Pure retry/give-up decision for one strand-heal drain pass (e2e test_43
 *  burst mechanism, round 3 — see `drainStrandedFlushes`). Given the ids
 *  stranded since the last heal (id -> content) and a path resolver (called
 *  AFTER the caller's manifest reconcile), partitions each id into: flush now
 *  (path resolved), retry (path still unknown, under the attempt cap), or
 *  give up (cap exceeded — content stays safe in the Y.Doc; no disk write, no
 *  further retry this session). `attempts` is mutated in place so repeated
 *  calls across drain cycles accumulate the count per id correctly. Exported
 *  standalone (no Obsidian API dependency) so the retry logic is unit-testable
 *  without standing up the full wiring. */
export function partitionStrandedFlushes(
	pending: Map<string, string>,
	resolvePath: (id: string) => string | null,
	attempts: Map<string, number>,
	maxAttempts: number,
): {
	toFlush: Array<{ id: string; path: string; content: string }>;
	toRetry: Array<{ id: string; content: string }>;
	toGiveUp: string[];
} {
	const toFlush: Array<{ id: string; path: string; content: string }> = [];
	const toRetry: Array<{ id: string; content: string }> = [];
	const toGiveUp: string[] = [];
	for (const [id, content] of pending) {
		const path = resolvePath(id);
		if (path) {
			attempts.delete(id);
			toFlush.push({ id, path, content });
			continue;
		}
		const attempt = (attempts.get(id) ?? 0) + 1;
		attempts.set(id, attempt);
		if (attempt >= maxAttempts) {
			toGiveUp.push(id);
		} else {
			toRetry.push({ id, content });
		}
	}
	return { toFlush, toRetry, toGiveUp };
}

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
	// Per-id heal attempt count (e2e test_43 burst mechanism, round 3): a single
	// manifest fetch can race a just-created note's own commit — the server
	// confirms the note exists moments later than this device's first heal
	// attempt reads the manifest. Without a retry, that one-shot miss permanently
	// stranded the id (content stays in the Y.Doc, but nothing ever calls
	// healUnknownNoteId again this session). Capped so a genuinely orphaned id
	// (never resolves) stops retrying.
	const strandHealAttempts = new Map<string, number>();

	async function drainStrandedFlushes(): Promise<void> {
		const pending = new Map(strandedFlushes);
		strandedFlushes.clear();
		try {
			await syncEngine.reconcileNoteIdMapFromManifest();
		} catch (e) {
			rlog().warn("crdt", `strand-heal reconcile failed: ${errMsg(e)}`);
		}
		const { toFlush, toRetry, toGiveUp } = partitionStrandedFlushes(
			pending,
			(id) => noteIdMap.pathForId(id),
			strandHealAttempts,
			STRAND_HEAL_MAX_ATTEMPTS,
		);
		for (const id of toGiveUp) {
			rlog().warn(
				"crdt",
				`onFlushToDisk: giving up on note_id=${id} after ` +
					`${STRAND_HEAL_MAX_ATTEMPTS} heal attempts — retained in Y.Doc`,
			);
		}
		// Re-queue unresolved ids for another debounced heal cycle instead of
		// dropping them after one manifest fetch — a just-created note (e.g. one
		// of several in a rapid burst) can commit server-side moments after this
		// device's first reconcile read the manifest.
		for (const { id, content } of toRetry) {
			rlog().warn(
				"crdt",
				`onFlushToDisk: still no path for note_id=${id} after heal — retrying`,
			);
			healUnknownNoteId(id, content);
		}
		for (const { path, content } of toFlush) {
			if (deps.isBound(path)) continue; // live editor owns disk
			// The primary onFlushToDisk path throws on a refused write; this healed
			// path can't await (fire-and-forget batch), so surface refusal/failure
			// via rlog instead of discarding it — content stays safe in the Y.Doc.
			syncEngine
				.flushFromCrdt(path, content)
				.then((ok) => {
					if (!ok)
						rlog().warn(
							"crdt",
							`strand-heal flush refused for ${path} — retained in Y.Doc`,
						);
				})
				.catch((e) =>
					rlog().warn(
						"crdt",
						`strand-heal flush failed for ${path}: ${errMsg(e)} — retained in Y.Doc`,
					),
				);
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
		canSendLive: deps.canSendLive,
		onFlushToDisk: async (noteId, content) => {
			const path = noteIdMap.pathForId(noteId);
			if (!path) {
				// Unknown id: a crdt_msg/STEP2 arrived for a note this device hasn't
				// learned a path for yet. Content is safe in the Y.Doc meanwhile;
				// healUnknownNoteId re-resolves the id from the manifest and retries so
				// a drift self-heals instead of stranding forever.
				healUnknownNoteId(noteId, content);
				return;
			}
			if (deps.isBound(path)) {
				// The editor owns disk — but a remote update just painted into it,
				// and headless/unfocused Obsidian may not save that buffer for a
				// long time on its own (fix wave 6). Nudge it.
				deps.onBoundUpdate?.(path);
				return;
			}
			// Propagate a disk-write failure so applyRemoteUpdate rejects and the
			// caller leaves crdtHead unadvanced (#235). flushFromCrdt returns false
			// ONLY on an actual write failure; a skip (gate closed / idempotent) and
			// a legacy void return both read as success.
			if ((await syncEngine.flushFromCrdt(path, content)) === false) {
				throw new Error(`flushFromCrdt reported a write failure for ${path}`);
			}
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
		// Fix wave 1: op-level convergence proof. Fires on every non-empty
		// inbound frame; commitCrdtConvergence is idempotent (no-op when nothing
		// is staged for this note_id), so fire-and-forget is safe here.
		onSynced: (noteId) => void syncEngine.commitCrdtConvergence(noteId),
		// Doc shape from the note's path. `.canvas` → the structural nodes/edges
		// schema; everything else → markdown. Resolved once per doc at creation.
		// The path is always mapped before a doc is minted in the normal push/pull
		// flows; an unmapped id (rare heal path) safely defaults to markdown.
		docKind: (noteId) => (noteIdMap.pathForId(noteId)?.endsWith(".canvas") ? "canvas" : "note"),
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
		channel.handleFrame(docId, b64).catch((e) => {
			// Malformed frame / doc-open failure: log + drop — never leak an
			// unhandled rejection from the inbound hot path.
			rlog().warn(
				"crdt",
				`handleFrame failed for note_id=${docId}: ${errMsg(e)} — frame dropped`,
			);
		});
	};

	// Vault-channel fan-out (P1): applies a server-pushed Yjs update to an IDLE
	// note (no dedicated CRDT room) without ever STEP1-enrolling it. The sync
	// engine itself guards confirmed/live-bound state and isolates failures.
	// Wrapped in applyLiveOpWithSeq (Phase D2 gap-heal, Task 3): the apply
	// ALWAYS runs (every branch); the per-path seq is stamped ONLY when the
	// apply reports the op actually landed ("applied"), so a pended/deferred
	// op can never fence-mask the replay row that carries its content.
	const onNoteYjsUpdate = (
		noteId: string,
		b64: string,
		head: string,
		seq?: number | null,
	): void => {
		void syncEngine.applyLiveOpWithSeq(noteId, seq, () =>
			syncEngine.applyPushedNoteUpdate(noteId, fromB64(b64), head),
		);
	};

	// Discovery: when another device opens a room (server announces
	// crdt_doc_ready), enroll the note here so a sync-step-1 fires and we pull it
	// even if we've never opened it.
	const onCrdtDocReady = (docId: string, announcedPath?: string): void => {
		// While the sync gate is closed, skip enrollment: STEP2 ops would integrate
		// into the Y.Doc but never flush, and after gate-accept the re-handshake
		// delivers zero new ops. Gating here keeps gated-period state out of the doc
		// entirely; the announce re-fires via pull discovery once the gate opens.
		if (syncEngine.isSyncBlocked()) return;
		// Live heal for the create-race: an announce naming an id the map cannot
		// resolve means another writer owns this note under an identity we never
		// learned — enrollment alone would sync a doc we can't flush (no path).
		// Kick the coalesced manifest reconcile so the mapping lands now, not at
		// the next cold start.
		syncEngine.ensureNoteIdMapped(docId);
		// Empty-note discovery (e2e test_27): an empty note's genesis emits ZERO
		// Y.Doc ops, so no note_yjs_update ever fans out — the announce carries only
		// the id and (now) the path. Without this the note is found ~30s later via
		// the level-triggered pull. When the announce carries a path, run a per-note
		// discovery+adopt now so the empty-materialize backstop writes the file in
		// seconds. discoverAnnouncedNote is gate-safe, skips notes already on disk /
		// live-bound / locally deleted, and NEVER opens a dedicated room (that was
		// the connect-storm) — it reuses the socket catch-up delta path and isolates
		// its own failure, so the fire-and-forget call can't throw out of here.
		if (announcedPath !== undefined)
			void syncEngine.discoverAnnouncedNote(docId, announcedPath);
		// Vault-channel fan-out: an IDLE note (not open in an editor) converges over
		// the note_yjs_update broadcast (applyPushedNoteUpdate) — it must NOT open a
		// dedicated room. This announce-driven enroll was the primary connect-storm
		// source: pre-fan-out, every crdt_doc_ready fanned an enroll to every device.
		// Enroll (STEP1) ONLY when a live editor binding owns the note, matching every
		// other enroll gate. An unmapped id can't be open, so pathForId null → skip.
		const path = noteIdMap.pathForId(docId);
		if (path !== null && deps.isBound(path)) enrollment.enroll(docId);
	};

	// Backend #955 (plugin #202): the server tells us when a crdt_msg we sent
	// was dropped for an unknown note_id — heal the id map immediately.
	// ensureNoteIdMapped is NOT disk-write-free (its reconcile can reach
	// sweepPendingOrphans → trashFile); it is intrinsically gate-safe (#204),
	// and we gate here too, matching the sibling onCrdtDocReady.
	const onCrdtNoteNotFound = (docId: string): void => {
		if (syncEngine.isSyncBlocked()) return;
		syncEngine.ensureNoteIdMapped(docId);
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
		onCrdtNoteNotFound,
		onNoteYjsUpdate,
		drainStrandedFlushes,
		clearStrandHealAttempts: () => strandHealAttempts.clear(),
		dispose,
	};
}

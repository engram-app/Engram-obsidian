import { errMsg } from "../error-util";
import { docKindFor } from "../file-kind";
import { noteRef } from "../note-ref";
import { rlog } from "../remote-log";
import type { SyncEngine } from "../sync";
import { isDestroyedError } from "./destroyed-error";
import { InvariantChecker, type InvariantViolation } from "./invariants";
import type { NoteIdMap } from "./note-id-map";
import { ProviderRegistry } from "./provider-registry";
import { fromB64 } from "./wire";

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

/** How often the structural invariants are swept. Cheap (set arithmetic over
 *  in-memory state), so this is about log volume, not CPU. */
const INVARIANT_CHECK_INTERVAL_MS = 60_000;

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
	/** Every currently bound path. Enumerable counterpart to `isBound`, so the
	 *  invariant checker can assert properties across the whole binding set
	 *  rather than one path at a time. Same lazy-closure reason as `isBound`.
	 *  Optional: a caller that omits it simply reports no bound paths, which
	 *  makes the binding invariants vacuous rather than throwing. */
	boundPaths?: () => string[];
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
	/** Merge base for a note_id (#357), resolved through the id map to the path
	 *  BaseStore is keyed by. Omitted = the pre-LCA path. */
	lcaFor?: (noteId: string) => string | null;
	/** A merge that could not apply every hunk. */
	onDirtyMerge?: (noteId: string) => void;
}

export interface CrdtWiring {
	/** The Relay-model engine — plays the old manager/channel/enrollment roles. */
	manager: ProviderRegistry;
	channel: ProviderRegistry;
	enrollment: ProviderRegistry;
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
	/** Run the structural invariant sweep once, on demand (Sync Center / e2e
	 *  probe). The periodic sweep runs on its own timer from wiring setup. */
	checkInvariants: () => Promise<InvariantViolation[]>;
	/** Reset per-id strand-heal retry counters. Call when the noteIdMap was just
	 *  reconciled wholesale (reconnect) — stranded ids deserve fresh attempts
	 *  against the now-current map, not counters left over from before the drift
	 *  was fixed (final review MINOR-6). */
	clearStrandHealAttempts: () => void;
	/** Re-enroll every doc whose live update was refused while the crdt: topic was
	 *  unjoined (offline / mid-reconnect). Call on rejoin AFTER re-enrolling open
	 *  notes so an edit made to a note that was then closed/switched-away-from
	 *  still converges via the mutual STEP1 handshake (switch-away data-loss). */
	reEnrollUnsent: () => void;
	/** Drop a doc from the unsent-tracking set. Call when the note is deleted so a
	 *  since-deleted note is never re-enrolled on the next rejoin (a spurious STEP1
	 *  that could race delete-wins / resurrect the note). */
	forgetUnsent: (docId: string) => void;
	/** Drop the WHOLE unsent-tracking set. Call on a vault change: these are the
	 *  PREVIOUS vault's note ids, and reEnrollUnsent would otherwise STEP1 every
	 *  one of them against the new vault's topic, where they resolve to nothing.
	 *  Per-vault state, dropped in lockstep with the note-id map (engram #1318). */
	clearUnsent: () => void;
	/** Clear the pending strand-heal timer (call from the plugin's onunload). */
	dispose: () => void;
}

const DEFAULT_STRAND_HEAL_DEBOUNCE_MS = 750;
const STRAND_HEAL_MAX_ATTEMPTS = 5;
/** Cap on the unsent-doc tracking set. Mirrors CrdtOpQueue.MAX_QUEUE: bounds
 *  memory across a long outage; past the cap the oldest tracked doc is evicted
 *  (it reconverges via the normal reconnect catch-up either way). */
const MAX_UNSENT_DOCS = 500;

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
							`strand-heal flush refused for ${noteRef(path)} — retained in Y.Doc`,
						);
				})
				.catch((e) =>
					rlog().warn(
						"crdt",
						`strand-heal flush failed for ${noteRef(path)}: ${errMsg(e)} — retained in Y.Doc`,
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

	// Docs whose live frame was refused (topic not joined, or create-ack held).
	// Re-enrolled on rejoin so a note edited offline then switched-away-from still
	// converges (the #299 switch-away recovery, widened past still-open notes).
	const unsentDocIds = new Set<string>();

	/** Track a refused doc under the documented 500-doc bound (evict oldest).
	 *  Both refusal branches below must route through this — the create-gate
	 *  branch once skipped the cap and grew the set unbounded over a long
	 *  offline burst of gated new notes. */
	const addUnsent = (docId: string): void => {
		if (!unsentDocIds.has(docId) && unsentDocIds.size >= MAX_UNSENT_DOCS) {
			for (const oldest of unsentDocIds) {
				unsentDocIds.delete(oldest);
				break;
			}
		}
		unsentDocIds.add(docId);
	};

	// The Relay-model engine plays all three old roles (manager + channel +
	// enrollment) — see provider-registry.ts. Its `send` wraps deps.sendCrdt with
	// the unsent-tracking + the create-ack gate; a refused frame buffers in the
	// provider and flushes on rejoin. There is NO onUpdate/box indirection: the
	// provider sends its own local updates through this `send`.
	const registry = new ProviderRegistry({
		dbPrefix: deps.dbPrefix,
		lcaFor: deps.lcaFor,
		onDirtyMerge: deps.onDirtyMerge,
		send: (docId, frame, kind) => {
			// Create-before-edit: hold OPS until the note's server row exists. Never
			// hold a "handshake" frame (syncStep1, or the syncStep2 written in reply
			// to one) — see FrameKind in note-provider.ts. Holding the pull made
			// socketConverge's diverged-note re-handshake a silent no-op for every
			// note discovered via note_changed whose Yjs fan-out was missed (#1130,
			// e2e test_48): hasServerNote stayed false forever, so the heal frame was
			// dropped and the note never caught up.
			if (kind === "op" && deps.canSendLive && !deps.canSendLive(docId)) {
				addUnsent(docId);
				return false;
			}
			// sendCrdt's return is P1's delivered/dropped signal (unknown-typed on the
			// dep); false === the socket refused the frame.
			const ok = deps.sendCrdt(docId, frame) !== false;
			if (!ok) {
				addUnsent(docId);
			} else {
				// A delivered HANDSHAKE clears the flag for a doc whose ops may still
				// be gate-held. Safe only because of call ordering: startSync sets
				// advertised (which sends the step1) and then calls setConnected(true),
				// whose buffer flush immediately re-refuses the held ops and re-adds
				// the id. Reorder those two and a gated doc silently drops out of
				// reEnrollUnsent tracking.
				unsentDocIds.delete(docId);
			}
			return ok;
		},
		onFlushToDisk: async (noteId, content) => {
			const path = noteIdMap.pathForId(noteId);
			if (!path) {
				// Unknown id: content is safe in the Y.Doc; heal the id from the
				// manifest and retry so a drift self-heals instead of stranding.
				healUnknownNoteId(noteId, content);
				return undefined;
			}
			// The editor owns disk for a bound path; a remote merge just painted in,
			// so nudge Obsidian's own save (fix wave 6) instead of double-writing.
			if (deps.isBound(path)) {
				deps.onBoundUpdate?.(path);
				return undefined;
			}
			// Return false on a real write failure so applyRemoteUpdate rejects and
			// the caller leaves crdtHead unadvanced (#235).
			return (await syncEngine.flushFromCrdt(path, content)) === false ? false : undefined;
		},
		// Adopt-first seed gate: never re-encode content the server already holds.
		isUnchangedSynced: (noteId, content) => {
			const path = noteIdMap.pathForId(noteId);
			return path ? syncEngine.isUnchangedSynced(path, content) : false;
		},
		onPersistError: (noteId, err) => {
			rlog().warn(
				"crdt",
				`IndexedDB persist error for ${noteRef(noteIdMap.pathForId(noteId))} (id=${noteId}) — sync continues in-memory: ${errMsg(err)}`,
			);
		},
		// Convergence commit (idempotent; no-op when nothing staged). The text-verify
		// gate inside is being retired — the provider already converged via STEP2.
		onSynced: (noteId) => void syncEngine.commitCrdtConvergence(noteId),
		// Empty first STEP2 = the server's "genuinely empty note" signal; materialize
		// off the handshake so a slow content STEP2 can't race an empty file (#547).
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
		docKind: (noteId) => docKindFor(noteIdMap.pathForId(noteId) ?? ""),
	});

	// The one engine plays all three old roles.
	const manager = registry;
	const channel = registry;
	const enrollment = registry;

	// docId is the bare note_id (Task 6) — forwarded to handleFrame directly.
	const onCrdtMessage = (docId: string, b64: string): void => {
		channel.receive(docId, b64).catch((e) => {
			// A frame for a DELETED note is expected, not a fault: the server can
			// fan out or reply for a note this device just tore down. Relay's
			// call sites (LiveViews) swallow exactly this error and nothing else —
			// dropping it here is the whole point of the tombstone, so it must not
			// masquerade as a malformed-frame warning.
			if (isDestroyedError(e)) {
				rlog().info("crdt", `frame dropped for deleted note_id=${docId}`);
				return;
			}
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

	// Runtime invariants (Relay parity). Violations report at WARN — the level
	// that actually reaches Loki — so structural drift surfaces in prod instead
	// of being inferred from a downstream symptom weeks later.
	const invariants = new InvariantChecker({
		getContext: () => ({
			removedNoteIds: registry.removedIds,
			residentNoteIds: new Set(registry.docs.keys()),
			enrolledNoteIds: registry.enrolled,
			liveBoundPaths: new Set(deps.boundPaths?.() ?? []),
			mappedPaths: new Set(Object.keys(noteIdMap.toJSON())),
			pathForId: (id) => noteIdMap.pathForId(id),
			idForPath: (path) => noteIdMap.get(path),
		}),
		onViolation: (v) => {
			rlog().warn("crdt", `invariant violated [${v.id}]: ${v.detail}`);
		},
	});
	invariants.startPeriodicChecks(INVARIANT_CHECK_INTERVAL_MS);

	function dispose(): void {
		invariants.stop();
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
		/** On-demand invariant sweep (Sync Center / e2e probe). */
		checkInvariants: () => invariants.checkAll(),
		clearStrandHealAttempts: () => strandHealAttempts.clear(),
		reEnrollUnsent: () => {
			// Snapshot: enroll() → startSync succeeds → clears the id from the set;
			// iterate a copy so that mutation can't skip entries mid-loop.
			for (const id of [...unsentDocIds]) enrollment.enroll(id);
		},
		forgetUnsent: (docId) => {
			unsentDocIds.delete(docId);
		},
		clearUnsent: () => {
			unsentDocIds.clear();
		},
		dispose,
	};
}

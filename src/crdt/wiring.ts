import { deferred } from "../deferred";
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
	| "flushStrandedNote"
	| "isUnchangedSynced"
	| "materializeEmptyDiscovered"
	| "isSyncBlocked"
	| "ensureNoteIdMapped"
	| "awaitNoteIdSettled"
	| "idMapEra"
	| "repairOrphanedClaim"
	| "clearPushedBaselineForId"
	| "applyPushedNoteUpdate"
	| "discoverAnnouncedNote"
	| "applyLiveOpWithSeq"
	| "commitCrdtConvergence"
	| "recordUndeliveredCrdtEdit"
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
	/** What the OPEN editor for `path` currently shows, or null when there is no
	 *  readable view for it. Backed by CrdtLiveViews, same lazy-closure reason
	 *  as `isBound`.
	 *
	 *  Needed because `onBoundUpdate` nudges Obsidian to save the EDITOR BUFFER,
	 *  and that buffer is only current for what the live binding paints — the
	 *  body. Frontmatter is observed by nothing, so nudging on a remote
	 *  frontmatter change writes the STALE block to disk and `seedContentInto`
	 *  puts it back in the doc: a silent revert (#483 defect 1). Comparing the
	 *  editor (not disk) is what makes it safe to type frontmatter locally.
	 *  Optional: omitted means "cannot confirm", which `boundFlushDecision`
	 *  resolves toward writing rather than reverting. */
	boundEditorText?: (path: string) => string | null;
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
	/** The provider-model engine — plays the old manager/channel/enrollment roles. */
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
	/** Heal every stranded id through the engine, then flush the mapped ones.
	 *  Exposed for tests + teardown; production fires it via the debounce timer
	 *  set in the manager's onFlushToDisk. */
	drainStrandedFlushes: () => Promise<void>;
	/** Run the structural invariant sweep once, on demand (Sync Center / e2e
	 *  probe). The periodic sweep runs on its own timer from wiring setup. */
	checkInvariants: () => Promise<InvariantViolation[]>;
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

	// Stranded ids (unknown id -> no disk path), coalesced so a burst of
	// stranded flushes shares ONE reconcile. Ids only: the drain writes the doc's
	// projection at drain time, never a snapshot from strand time (#569).
	const strandedFlushes = new Set<string>();
	let strandHealTimer: number | null = null;
	let disposed = false;
	/** Resolved by dispose: releases heals still parked in the engine. */
	const disposal = deferred();
	/** Ids whose heal is in flight: single-flight per id, not per drain. */
	const healing = new Set<string>();

	/** Heal every stranded id through the engine and flush each one as soon as
	 *  its own heal settles, so one slow id holds back no sibling and no later
	 *  drain. The engine owns retry, backoff, the gate and give-up:
	 *  `awaitNoteIdSettled` resolves when the id is mapped, refused or given
	 *  up, and parks (no timer) while the gate is closed. An id already being
	 *  healed is left stranded for its own heal's end. */
	function drainStrandedFlushes(): Promise<void> {
		if (disposed) return Promise.resolve();
		const ids = [...strandedFlushes].filter((id) => !healing.has(id));
		for (const id of ids) strandedFlushes.delete(id);
		return Promise.all(ids.map(healStranded)).then(() => {});
	}

	async function healStranded(id: string): Promise<void> {
		healing.add(id);
		try {
			const era = syncEngine.idMapEra();
			const startedAt = Date.now();
			const how = await Promise.race([
				syncEngine.awaitNoteIdSettled(id),
				disposal.promise.then(() => "declined" as const),
			]);
			if (disposed || syncEngine.idMapEra() !== era) return; // an id of a gone vault
			flushHealed(id, startedAt, how === "gave-up");
		} finally {
			healing.delete(id);
			// Re-stranded while healing and not covered by its flush: drain again.
			if (strandedFlushes.has(id)) healUnknownNoteId(id);
		}
	}

	function flushHealed(id: string, startedAt: number, gaveUp: boolean): void {
		const path = noteIdMap.pathForId(id);
		if (path === null) {
			// A deliberate decline (refused path, deleted here, parked as never
			// listed) is not a failure: only a real give-up warns.
			if (!gaveUp) return;
			const secs = Math.round((Date.now() - startedAt) / 1000);
			rlog().warn(
				"crdt",
				`onFlushToDisk: giving up on note_id=${id} after ${secs}s: the id-map heal ` +
					"could not map it — retained in Y.Doc",
			);
			return;
		}
		// The flush writes the doc's projection now, which covers a re-strand
		// of the same id while it healed: drop that too.
		strandedFlushes.delete(id);
		if (deps.isBound(path)) return; // live editor owns disk
		// The primary onFlushToDisk path throws on a refused write; this healed
		// path can't await (fire-and-forget batch), so surface refusal/failure
		// via rlog instead of discarding it — content stays safe in the Y.Doc.
		syncEngine
			.flushStrandedNote(path, id)
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
					`strand-heal flush failed for ${noteRef(path)}: ${errMsg(e, path)} — retained in Y.Doc`,
				),
			);
	}

	/** Re-resolve a stranded inbound CRDT note (unknown id -> no disk path)
	 *  through the engine's id-map heal, then retry the flush. Debounced so a
	 *  burst of stranded flushes shares one drain. */
	function healUnknownNoteId(noteId: string): void {
		strandedFlushes.add(noteId);
		if (disposed || strandHealTimer !== null) return;
		strandHealTimer = window.setTimeout(() => {
			strandHealTimer = null;
			void drainStrandedFlushes();
		}, debounceMs);
	}

	// The provider-model engine plays all three old roles (manager + channel +
	// enrollment) — see provider-registry.ts. Its `send` wraps deps.sendCrdt with
	// the create-ack gate and durable recording of refused ops; a refused frame
	// also buffers in the provider and flushes on rejoin. There is NO onUpdate/box indirection: the
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
			//
			// A refused frame's edit stays in the Y.Doc; the durable queue records
			// that it still has to be delivered (#516 — see
			// `SyncEngine.recordUndeliveredCrdtEdit`).
			if (kind === "op" && deps.canSendLive && !deps.canSendLive(docId)) {
				syncEngine.recordUndeliveredCrdtEdit(docId);
				return false;
			}
			// sendCrdt's return is P1's delivered/dropped signal (unknown-typed on the
			// dep); false === the socket refused the frame.
			const ok = deps.sendCrdt(docId, frame) !== false;
			if (!ok && kind === "op") syncEngine.recordUndeliveredCrdtEdit(docId);
			return ok;
		},
		onFlushToDisk: async (noteId, content, fmChanged) => {
			const path = noteIdMap.pathForId(noteId);
			if (!path) {
				// Unknown id: content is safe in the Y.Doc; heal the id from the
				// manifest and retry so a drift self-heals instead of stranding.
				healUnknownNoteId(noteId);
				return undefined;
			}
			// The editor owns disk for a bound path; a remote merge just painted in,
			// so nudge Obsidian's own save (fix wave 6) instead of double-writing.
			//
			// "Painted in" covers the BODY only. Nothing observes the frontmatter
			// shared types, so on a remote FRONTMATTER change the nudge saves the
			// editor's stale block over the new one and seedContentInto writes it
			// back into the doc — reverted, not merely delayed (#483 defect 1).
			//
			// `fmChanged` comes from the registry, which compares this projection's
			// block against the previous one. It deliberately does NOT ask the
			// editor: in Live Preview the CM document is body-only, so it carries
			// no fence and every note WITH frontmatter looked changed — turning the
			// nudge into a direct write under a live editor on the default mode.
			if (deps.isBound(path) && !fmChanged) {
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
				`IndexedDB persist error for ${noteRef(noteIdMap.pathForId(noteId))} (id=${noteId}) — sync continues in-memory: ${errMsg(err, noteIdMap.pathForId(noteId))}`,
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
			// fan out or reply for a note this device just tore down. Swallow
			// exactly this error and nothing else — dropping it here is the whole
			// point of the tombstone, so it must not
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
		//
		// Discovery FIRST. Empty-note discovery (e2e test_27): an empty note's
		// genesis emits ZERO Y.Doc ops, so no note_yjs_update ever fans out — the
		// announce carries only the id and the path. discoverAnnouncedNote maps the
		// id from that path and materializes the note in seconds; it is gate-safe,
		// skips ignored paths, notes already on disk / live-bound / locally deleted
		// (incl. a pending offline delete), NEVER opens a dedicated room (that was
		// the connect-storm), and isolates its own failure.
		//
		// Only an id discovery left unmapped (no path, or a file already on disk)
		// falls back to the whole-vault manifest reconcile, which is throttled: on
		// a 1,000-note import (e2e test_77) running it first cost ~970 manifest
		// GETs for notes discovery maps for free.
		//
		// The heal runs after discovery's whole seq replay. That delays only the
		// background mapping of an id the replay re-keyed away; a fan-out for it
		// never waits, since applyPushedNoteUpdate heals its own id urgently.
		// A vault switch during discovery's replay: this id belongs to the old
		// vault, so do not heal it against the new one's manifest.
		const era = syncEngine.idMapEra();
		const heal = (): void => {
			if (syncEngine.idMapEra() !== era) return;
			syncEngine.ensureNoteIdMapped(docId); // a no-op once discovery mapped it
		};
		if (announcedPath === undefined) heal();
		// finally-style: a discovery throw (one escaping its own try) must
		// not skip the fallback or surface as an unhandled rejection.
		else
			void syncEngine
				.discoverAnnouncedNote(docId, announcedPath)
				.catch((e) =>
					rlog().warn(
						"crdt",
						`announce discovery failed for ${noteRef(announcedPath)}: ${errMsg(e, announcedPath)}`,
					),
				)
				.then(heal)
				.catch((e) =>
					rlog().warn("crdt", `announce id-map heal failed for ${docId}: ${errMsg(e)}`),
				);
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
		// Healing the map is only half of it: the dropped frame's content was
		// already banked as the echo baseline when routeModify consumed it, so a
		// re-mapped note would still echo-skip its own undelivered bytes forever.
		// Un-bank first — the reconcile below can re-key the map out from under
		// the lookup this needs.
		syncEngine.clearPushedBaselineForId(docId);
		// THIS reply — not the announce — is the server stating it has no row for
		// the id, which is what licenses re-driving the create (#1550). Handled
		// before the reconcile because that sweep cannot see an orphan at all:
		// it iterates the notes the server LISTS, and an id the server has never
		// had appears in none of them.
		if (syncEngine.repairOrphanedClaim(docId)) return;
		// Not fresh evidence (a reply to our own frame): it must not restore the
		// heal's retry budget.
		syncEngine.ensureNoteIdMapped(docId, "internal");
	};

	// The mint guard must be able to tell a live claim from a headstone. Wired
	// here because it is the one place that holds both the identity store and
	// the registry that owns tombstones; SyncStore itself must not reach for the
	// registry. Without it, a note recreated at the path of a REMOTELY deleted
	// one resolves to that note's destroyed doc and cannot sync until reload.
	// Optional-chained for the test doubles, which hand in a bare NoteIdMap-shaped
	// object with no store. Production always has one — NoteIdMap constructs its
	// own when the index room does not supply it.
	noteIdMap.store?.setTombstoneCheck?.((noteId) => registry.removedIds.has(noteId));

	// Runtime invariants (invariant). Violations report at WARN — the level
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
		disposed = true;
		disposal.resolve();
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
		dispose,
	};
}

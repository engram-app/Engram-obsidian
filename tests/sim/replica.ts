// tests/sim/replica.ts
//
// The integration keystone of the convergence sim: boot the REAL SyncEngine +
// CrdtManager + NoteChannel + NoteIdMap + EngramApi headless, in-process,
// against the ModelServer (Task 4). The wiring below MIRRORS src/main.ts's
// production order exactly — the audit's "untested main.ts seam" is closed by
// construction. Every `main.ts:NNNN` citation names the line transcribed.
//
// WHAT IS FAITHFULLY REPRODUCED (data plane):
//   - EngramApi construction + setVaultId/setDeviceId          (main.ts:359-365)
//   - SyncEngine construction (app, api, settings, saveData)   (main.ts:387-400)
//   - the post-construction setters, IN ORDER:
//       syncLog / setCrdtLiveCheck / setNoteIdMap / setDeviceId /
//       setCrdtEditorDetach / setCrdtEditorRebind              (main.ts:402-434)
//       CrdtOpQueue + setCrdtEnqueue                           (main.ts:480-530)
//   - the four vault events -> engine methods                  (main.ts:575-627, 851-857)
//   - connectChannel's order: getMe -> new NoteChannel -> onEvent/onStatusChange
//       -> setCrdtCreate/Batch/Delete/CatchupSince -> createCrdtWiring +
//       setCrdtEnrollment + channel.onCrdt* handlers + onCrdtJoined(setCrdtManager)
//       -> channel.connect()                                   (main.ts:1666-2013)
//
// WHAT IS OMITTED (control plane, NOT the wiring order this task guards):
//   - the epoch / identity-mismatch retry / reconnect-backoff guards
//     (main.ts:1671-1698, connectChannel is single-shot here);
//   - ensureDocSchema IDB-wipe (main.ts:1842-1868) — a schema-migration
//     lifecycle step, not a convergence path;
//   - CrdtLiveViews + the CodeMirror editor extension (no Obsidian editor
//     headless). The ONE convergence-relevant behaviour that binding drives —
//     STEP1 enrollment (history-FULL Y.Doc) + the bound-note edit/flush routing
//     it gates — is modeled DIRECTLY here (see openNote/closeNote/editNote and
//     the boundPaths set) against the SAME real CrdtEnrollment / CrdtManager /
//     SyncEngine seams main.ts wires (main.ts:623 enroll-on-open,
//     :1912/:1962 isBound + setLiveBoundCheck, :1916 onBoundUpdate,
//     reEnrollOpenCrdtNotes on rejoin). What is NOT reproduced is the
//     per-keystroke y-codemirror.next binding: an edit to an OPEN note feeds the
//     Y.Text via `manager.applyLocalEdit` (the same manager method routeModify
//     drives) in ONE whole-content diff instead of keystroke deltas — end Y.Text
//     state is identical, both emit valid Yjs updates on the shared lineage.
//     This is the sim's one editor stand-in (T1); everything else is real-class;
//   - the plan-state / folder-resync / vault-deleted / auth-provider / remote-
//     logger plumbing — none of it touches the note-convergence data plane.
//
// SIM SEAM (sanctioned by CrdtWiringDeps.dbPrefix's own docstring): both
// replicas share ONE process => ONE fake-indexeddb. Production omits dbPrefix
// because each real device has its own browser origin; here we namespace the
// IndexedDB store per-replica (dbPrefix = id) so the two "devices" don't
// converge through shared IDB instead of over the network. The crdt: TOPIC
// vaultId stays shared (same vault) — only the local store name is namespaced.

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
// Route the engine's `import { requestUrl } from "obsidian"` at the model
// server. preload.ts already wraps obsidian's requestUrl as a bun Mock; a
// second mock.module() does NOT rebind an already-evaluated import binding
// (bun 1.3), so we point that existing Mock's implementation at the shim's
// injectable requestUrl instead. setRequestUrlHandler() then plugs the model
// server into the shim per-run, exactly as designed. `mockedRequestUrl` is the
// SAME function object src/api.ts holds, so the redirect reaches the engine.
import { requestUrl as mockedRequestUrl } from "obsidian";
import { EngramApi } from "../../src/api";
import { NoteChannel } from "../../src/channel";
import { applyCmChangesToYText, textDiffToChangeSpec } from "../../src/crdt/live/cm-yjs-bridge";
import {
	decideLoadedReconcile,
	decideReconcile,
	frontmatterPrefixLen,
} from "../../src/crdt/live/live-binding-decisions";
import { NoteIdMap } from "../../src/crdt/note-id-map";
import type { ProviderRegistry } from "../../src/crdt/provider-registry";
import { createCrdtWiring } from "../../src/crdt/wiring";
import { makeCrdtOpSend } from "../../src/crdt-op-dispatch";
import { type CrdtOp, CrdtOpQueue } from "../../src/crdt-op-queue";
import { reconcileColdStart, SyncEngine } from "../../src/sync";
import { SyncLog } from "../../src/sync-log";
import { DEFAULT_SETTINGS, type EngramSyncSettings } from "../../src/types";
import { requestUrl as baseRequestUrl, normalizePath, TFile, TFolder } from "../__mocks__/obsidian";
import type { SimClock } from "./clock";
import type { ModelServer } from "./model-server";
import { setRequestUrlHandler, requestUrl as shimRequestUrl } from "./obsidian-shim";
import { currentIncarnation, type Incarnation, newIncarnation, runAs } from "./process";
import type { Scheduler } from "./scheduler";
import { makeVault, type SimApp, type VaultEvents, type WriteJournalEntry } from "./vault-fs";

let requestUrlRedirected = false;

/** Transaction origin for the sim's editor stand-in, as the CM6 binding uses
 *  itself (live-binding.ts `doc.transact(..., this)`): a local edit. */
const BINDING_ORIGIN = Symbol("sim-editor-binding");

// ---------------------------------------------------------------------------
// WebSocket adapter: bridges NoteChannel <-> SimSocket over scheduler lanes.
// NoteChannel news up a global `WebSocket(url)`, attaches onopen/onmessage/
// onclose, reads readyState === WebSocket.OPEN, and .send()s Phoenix-v2 frame
// strings. We install a SimWebSocket that wraps server.connect(clientId):
//   - client -> server: .send(raw) -> sock.send(raw)  (server processes SYNC,
//     then queues its replies/fan-out on the `net:<id>` lane);
//   - server -> client: sock.onmessage(raw) -> this.onmessage({data: raw})
//     (already crossing the scheduler — the model enqueues every deliver());
//   - open: enqueued on a `ws-open:<id>` lane so it lands AFTER the channel
//     attaches its handlers (real WS opens on a later tick) and crosses the
//     scheduler like every other event.
// clientId is carried in the url's `device_id` param (NoteChannel sets it from
// its deviceId ctor arg — we pass the replica id).
// ---------------------------------------------------------------------------

interface SocketReg {
	server: ModelServer;
	scheduler: Scheduler;
}
const socketRegistry = new Map<string, SocketReg>();
let wsInstalled = false;
let installedClocks = new WeakSet<SimClock>();

// The REAL originals of every process-global boot() patches, snapshotted ONCE
// on the first install (before any patch runs). restoreGlobals() puts these
// back so that in a full `bun test` run, files sorted AFTER tests/sim/ see clean
// globals instead of a frozen virtual clock / no-op setInterval. Captured once
// (guarded) so a second boot — which sees already-patched globals — never
// overwrites the saved reals with a patched value.
interface CapturedGlobals {
	setTimeout: typeof globalThis.setTimeout;
	clearTimeout: typeof globalThis.clearTimeout;
	setInterval: typeof globalThis.setInterval;
	clearInterval: typeof globalThis.clearInterval;
	dateNow: typeof Date.now;
	setImmediate: unknown;
	webSocket: unknown;
	indexedDB: unknown;
}
let capturedGlobals: CapturedGlobals | null = null;

class SimWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	readyState = SimWebSocket.CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((evt: { data: string }) => void) | null = null;
	onerror: ((evt: unknown) => void) | null = null;
	onclose: ((evt?: { code?: number; reason?: string; wasClean?: boolean }) => void) | null = null;

	private readonly sock: ReturnType<ModelServer["connect"]>;
	private readonly reg: SocketReg;
	private readonly clientId: string;
	/** The device process that opened this socket (process.ts). A dead one's
	 *  socket delivers nothing; every delivery re-enters its context. */
	private readonly inc: Incarnation | undefined;

	constructor(url: string) {
		const clientId = new URL(url).searchParams.get("device_id");
		if (!clientId) throw new Error(`SimWebSocket: no device_id in ${url}`);
		const reg = socketRegistry.get(clientId);
		if (!reg) throw new Error(`SimWebSocket: no server registered for client ${clientId}`);
		this.clientId = clientId;
		this.reg = reg;
		this.inc = currentIncarnation();
		this.sock = reg.server.connect(clientId);
		this.sock.onmessage = (raw: string) => {
			if (this.inc?.dead || this.readyState === SimWebSocket.CLOSED) return;
			runAs(this.inc, () => this.onmessage?.({ data: raw }));
		};
		if (this.inc) liveSockets.set(this.inc, this);
		reg.scheduler.enqueue(`ws-open:${clientId}`, () => {
			if (this.inc?.dead || this.readyState === SimWebSocket.CLOSED) return;
			runAs(this.inc, () => {
				this.readyState = SimWebSocket.OPEN;
				this.onopen?.();
			});
		});
	}

	/** The connection died under the client (network drop, a suspended app's
	 *  socket timed out server-side): the server forgets it at once. With
	 *  `notifyClient` the client learns through its close handler, as a real
	 *  unclean close; without, it finds out when it next probes. */
	dropFromNetwork(notifyClient: boolean): void {
		this.reg.server.killClient(this.clientId);
		if (this.readyState === SimWebSocket.CLOSED || !notifyClient) return;
		this.readyState = SimWebSocket.CLOSED;
		this.reg.scheduler.enqueue(`ws-close:${this.clientId}`, () => {
			if (this.inc?.dead) return;
			runAs(this.inc, () => this.onclose?.({ code: 1006, reason: "", wasClean: false }));
		});
	}

	send(raw: string): void {
		this.sock.send(raw);
	}

	close(): void {
		if (this.readyState === SimWebSocket.CLOSED) return;
		this.readyState = SimWebSocket.CLOSED;
		this.sock.close();
		// Fire onclose across the scheduler. NoteChannel.disconnect() nulls onclose
		// before calling close() (no reconnect on an intentional disconnect), so on
		// that path this is a no-op; only a server-driven close would deliver.
		this.reg.scheduler.enqueue(`ws-close:${this.clientId}`, () => {
			if (this.inc?.dead) return;
			runAs(this.inc, () => this.onclose?.({ code: 1000, reason: "", wasClean: true }));
		});
	}
}

/** The newest socket each device process opened, so the sim can drop it. */
const liveSockets = new WeakMap<Incarnation, SimWebSocket>();

/** HTTP replies that landed while a process was suspended; failed on resume. */
const parkedReplies = new WeakMap<Incarnation, Array<() => void>>();
function parkedFor(inc: Incarnation): Array<() => void> {
	let list = parkedReplies.get(inc);
	if (!list) {
		list = [];
		parkedReplies.set(inc, list);
	}
	return list;
}

/** What a device keeps across a restart in data.json: the subset of main.ts's
 *  savePluginData that the sync data plane reads back (main.ts onload restore,
 *  :916-950 and :1672). IndexedDB (Y.Docs, acked marks) survives on its own:
 *  the store is per replica id, not per process. */
export interface PersistedData {
	lastSync?: string;
	catchupSeq?: number;
	catchupId?: string | null;
	manifestSeq?: number;
	offlineQueue?: ReturnType<SyncEngine["queue"]["persistable"]>;
	crdtOpQueue?: CrdtOp[];
	syncState?: ReturnType<SyncEngine["exportSyncState"]>;
	syncStateVaultId?: string | null;
	noteIds?: Record<string, string>;
	gateJournal?: ReturnType<SyncEngine["exportGateJournal"]>;
}

export interface ReplicaBootOpts {
	id: string;
	server: ModelServer;
	scheduler: Scheduler;
	clock: SimClock;
	/** Shared root; the replica's vault lives at `${rootDir}/${id}`. */
	rootDir: string;
	/** data.json across restarts: written on every engine save, restored at
	 *  boot. Pass the previous process's object to boot a restart. */
	persisted?: PersistedData;
	/** Boot as a RESTART of an existing device: run main.ts's layout-ready
	 *  startup (map reconcile, gate replay, cold-start reconcile,
	 *  pushModifiedFiles) after restoring `persisted`. */
	restart?: boolean;
	/** Process number, for traces. */
	incarnation?: number;
}

const VAULT_ID = "vsim";
/** The user id the model server's /me returns for every replica — see boot(). */
const SIM_USER_ID = "sim-user";

export class Replica {
	readonly id: string;
	readonly engine: SyncEngine;
	readonly vaultDir: string;
	readonly noteIdMap: NoteIdMap;
	/** Oracle (Task 6) accessor: the real CrdtManager backing this replica's
	 *  Y.Docs, for reading projected text / state vector directly off the
	 *  CRDT (not disk) — the "doc-text" and "head" convergence surfaces. */
	readonly crdtManager: ProviderRegistry;

	private readonly app: SimApp;
	private readonly channel: NoteChannel;
	private readonly enrollment: ProviderRegistry;
	/** Paths this replica has "opened" in an editor (makes isBound true + drives
	 *  the live-editor edit/flush routing). Modeled here because there is no real
	 *  CrdtLiveViews headless — see the file header's editor-binding note. */
	private readonly boundPaths: Set<string>;
	/** Opened paths whose Y.Doc has been SEEDED (history-full) — the point the
	 *  real EditorController activates its binding and starts forwarding edits.
	 *  Before this, `bindTo` DEFERS (`deferUntilSeeded`, editor-controller.ts:110)
	 *  precisely so a keystroke never seeds a second lineage on top of the
	 *  server's (the #234/#846 doubling). editNote AND the bound-disk flush honor
	 *  this gate: until seed, the editor BUFFER (= disk) is authoritative, so the
	 *  flush must not overwrite disk with the still-empty Y.Text (a wipe). */
	private readonly hydrated: Set<string>;
	/** This device process (process.ts). Killed by `kill`, frozen by `suspend`. */
	readonly inc: Incarnation;
	readonly persisted: PersistedData;
	private readonly server: ModelServer;
	private readonly onUnload: () => void;
	/** Open paths with keystrokes typed before the binding went live. */
	private readonly dirty = new Set<string>();

	private constructor(args: {
		id: string;
		engine: SyncEngine;
		vaultDir: string;
		noteIdMap: NoteIdMap;
		crdtManager: ProviderRegistry;
		app: SimApp;
		channel: NoteChannel;
		enrollment: ProviderRegistry;
		boundPaths: Set<string>;
		hydrated: Set<string>;
		inc: Incarnation;
		persisted: PersistedData;
		server: ModelServer;
		onUnload: () => void;
	}) {
		this.id = args.id;
		this.engine = args.engine;
		this.vaultDir = args.vaultDir;
		this.noteIdMap = args.noteIdMap;
		this.crdtManager = args.crdtManager;
		this.app = args.app;
		this.channel = args.channel;
		this.enrollment = args.enrollment;
		this.boundPaths = args.boundPaths;
		this.hydrated = args.hydrated;
		this.inc = args.inc;
		this.persisted = args.persisted;
		this.server = args.server;
		this.onUnload = args.onUnload;
	}

	/** Oracle (Task 6) accessor: the #288 wipe-detector journal — every
	 *  create/modify/process write this replica's vault performed, in order. */
	writeJournal(): WriteJournalEntry[] {
		return this.app.writeJournal;
	}

	/**
	 * Restore every process-global boot() patched (SimClock timers + Date.now,
	 * setInterval no-op, setImmediate route, WebSocket, indexedDB, requestUrl
	 * mock) back to the reals snapshotted on the first boot, and clear the
	 * install state so a later boot re-installs cleanly. Call from an
	 * `afterAll()` in every sim test file so files sorted after tests/sim/ in a
	 * full `bun test` run see clean globals. Idempotent: safe to call when
	 * nothing is installed (no-op) and safe for multiple files to each restore.
	 */
	static restoreGlobals(): void {
		if (!capturedGlobals) return;
		const g = globalThis as unknown as Record<string, unknown>;
		globalThis.setTimeout = capturedGlobals.setTimeout;
		globalThis.clearTimeout = capturedGlobals.clearTimeout;
		globalThis.setInterval = capturedGlobals.setInterval;
		globalThis.clearInterval = capturedGlobals.clearInterval;
		Date.now = capturedGlobals.dateNow;
		g.setImmediate = capturedGlobals.setImmediate;
		g.WebSocket = capturedGlobals.webSocket;
		g.indexedDB = capturedGlobals.indexedDB;
		// Revert the preload requestUrl mock to its default implementation.
		(
			mockedRequestUrl as unknown as { mockImplementation: (fn: unknown) => void }
		).mockImplementation(baseRequestUrl);
		capturedGlobals = null;
		installedClocks = new WeakSet<SimClock>();
		wsInstalled = false;
		requestUrlRedirected = false;
	}

	static async boot(opts: ReplicaBootOpts): Promise<Replica> {
		const inc = newIncarnation(opts.id, opts.incarnation ?? 0);
		return runAs(inc, () => Replica.bootAs(opts, inc));
	}

	private static async bootAs(opts: ReplicaBootOpts, inc: Incarnation): Promise<Replica> {
		const { id, server, scheduler, clock, rootDir } = opts;
		const persisted: PersistedData = opts.persisted ?? {};

		// Snapshot the REAL globals ONCE, before any patch below runs, so
		// restoreGlobals() can undo the leak after the sim tests finish.
		const g = globalThis as unknown as Record<string, unknown>;
		if (!capturedGlobals) {
			capturedGlobals = {
				setTimeout: globalThis.setTimeout,
				clearTimeout: globalThis.clearTimeout,
				setInterval: globalThis.setInterval,
				clearInterval: globalThis.clearInterval,
				dateNow: Date.now,
				setImmediate: g.setImmediate,
				webSocket: g.WebSocket,
				indexedDB: g.indexedDB,
			};
		}

		// Install the SimClock timers BEFORE booting so every engine/channel timer
		// is virtual (the deliverable's requirement). Idempotent per clock.
		if (!installedClocks.has(clock)) {
			// Fresh IndexedDB per sim run: earlier test files in the same bun process
			// (tests/crdt, tests/sync — all `import "fake-indexeddb/auto"`) leave open
			// IndexeddbPersistence connections + accumulated stores in the ONE shared
			// factory. A stale open connection makes a later store open block and
			// re-poll forever, which livelocks drain() (the store's whenSynced never
			// settles). A clean factory keyed to this run isolates the two replicas'
			// namespaced stores from that residue.
			(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
			clock.install(globalThis);
			// Exclude perpetual keepalive/telemetry intervals from the deterministic
			// sim: the channel heartbeat (channel.ts:749) and remote-log flush
			// (remote-log.ts:150) are wall-clock keepalives, not convergence timers —
			// left live they make `drain()` (which quiesces on "no lanes + no timers")
			// livelock forever. The scheduler owns delivery, so there is no real socket
			// to keep alive. The one convergence-relevant periodic (the CrdtOpQueue
			// retry tick) is driven as a one-shot below instead.
			(globalThis as unknown as { setInterval: () => number }).setInterval = () => 0;
			// fake-indexeddb schedules its async DB tasks via globalThis.setImmediate
			// (real macrotask — outside the scheduler). Route it through the virtual
			// clock so IndexeddbPersistence.whenSynced / reads / writes are driven
			// DETERMINISTICALLY by drain(): without this, drain() reaches "no lanes +
			// no timers" and returns while IDB work is still pending on the real event
			// loop, so a note's Y.Doc seed (manager.entry -> whenSynced) never lands.
			// Ungated: IndexedDB's task queue must drain even for a killed or
			// suspended device, or a later process's transactions on the same
			// store queue forever behind a half-run one (see clock.ts Entry).
			(globalThis as unknown as { setImmediate: (fn: () => void) => number }).setImmediate = (
				fn: () => void,
			) => clock.setTimeout(fn, 0, true);
			installedClocks.add(clock);
		}
		// Install the WebSocket adapter once; register this replica's routing.
		if (!wsInstalled) {
			(globalThis as unknown as { WebSocket: unknown }).WebSocket = SimWebSocket;
			wsInstalled = true;
		}
		socketRegistry.set(id, { server, scheduler });
		// Point the preload-mocked requestUrl at the shim (once) so the engine's
		// REST hits the model server via setRequestUrlHandler below.
		if (!requestUrlRedirected) {
			(
				mockedRequestUrl as unknown as { mockImplementation: (fn: unknown) => void }
			).mockImplementation(shimRequestUrl);
			requestUrlRedirected = true;
		}
		// Route the engine's requestUrl at the model server. CRITICAL: settle the
		// reply on a scheduler LANE, not synchronously. The model's HTTP is a pure
		// function, but resolving inline would make an in-flight REST call invisible
		// to drain() — a fire-and-forget chain (e.g. onCrdtDocReady ->
		// discoverAnnouncedNote's pull) would then suspend on a microtask with no
		// pending lane/timer, drain() would declare quiescence, and the chain would
		// finish on the real event loop AFTER the assertions. Landing every reply on
		// a lane keeps the whole chain inside drain's accounting (mirrors the WS
		// adapter). The compute still happens at settle time, so a POST that mutates
		// state is ordered by the scheduler like any other delivery.
		setRequestUrlHandler(
			(o) =>
				new Promise((resolve, reject) => {
					// The CALLER's device process, not the last-booted one: the handler
					// is process-global. A dead caller never hears back; a suspended
					// one's reply is failed on resume (the OS killed the request).
					const caller = currentIncarnation();
					scheduler.enqueue(`http:${caller?.replicaId ?? id}`, () => {
						if (caller?.dead) return;
						if (caller?.frozen) {
							parkedFor(caller).push(() =>
								runAs(caller, () =>
									reject(new Error("request failed: network lost")),
								),
							);
							return;
						}
						const res = server.http({
							method: o.method ?? "GET",
							url: o.url,
							headers: o.headers,
							body: typeof o.body === "string" ? o.body : undefined,
						});
						// Mirror Obsidian's throw-on-4xx/5xx unless throw:false. Callers
						// classify on `.status` (api.ts 402/401/404/409), so attach it.
						if (res.status >= 400 && o.throw !== false) {
							reject(
								Object.assign(new Error(`request failed: ${res.status}`), {
									status: res.status,
								}),
							);
							return;
						}
						resolve({
							status: res.status,
							json: res.json,
							text: res.text,
							arrayBuffer: new ArrayBuffer(0),
							headers: {},
						} as unknown as import("obsidian").RequestUrlResponse);
					});
				}),
		);

		const vaultDir = `${rootDir}/${id}`;
		const noteIdMap = new NoteIdMap();

		// The vault fires these explicitly (no fs watcher). Route file-vs-folder
		// exactly as main.ts's registerEvent handlers do, using getAbstractFileByPath
		// where the entity still resolves; `delete` fires after removal (as in real
		// Obsidian) and carries its kind instead. See vault-fs VaultEvents
		// docstring: main.ts:575-578 / 852-857 / 609-614 / 618-619.
		const events: VaultEvents = {
			onModify: (p) => {
				const f = app.vault.getAbstractFileByPath(p);
				if (f instanceof TFile) engine.handleModify(f); // main.ts:576-578
			},
			onCreate: (p) => {
				const f = app.vault.getAbstractFileByPath(p);
				if (f instanceof TFolder)
					void engine.handleFolderCreate(f); // main.ts:853-854
				else if (f instanceof TFile) engine.handleModify(f); // main.ts:856
			},
			onDelete: (p, isFolder) => {
				// The entity is already gone from the index (as in real Obsidian),
				// so reconstruct it from the kind the shim passes rather than
				// looking it up — a lookup here resolves to null and drops the
				// event entirely.
				const f: TFile | TFolder = isFolder ? new TFolder(p) : new TFile(p);
				if (f instanceof TFolder)
					void engine.handleFolderDelete(f); // main.ts:610-611
				else if (f instanceof TFile) {
					void engine.handleDelete(f); // main.ts:613
				}
			},
			onRename: (oldP, newP) => {
				const f = app.vault.getAbstractFileByPath(newP);
				if (f) void engine.handleRename(f, oldP); // main.ts:618-619
			},
		};
		const app = makeVault(vaultDir, events);

		const settings: EngramSyncSettings = {
			...DEFAULT_SETTINGS,
			apiUrl: "http://sim.local/api",
			apiKey: `token-${id}`,
			vaultId: VAULT_ID,
			userEmail: "sim@example.com",
			// Small but non-zero: keeps handleModify's debounce a real (virtual) timer
			// that drain() fires after the network settles, mirroring production timing.
			debounceMs: 10,
			clientId: `client-${id}`,
		};

		// --- EngramApi (main.ts:359-365) ---
		const api = new EngramApi(settings.apiUrl, settings.apiKey);
		api.setVaultId(settings.vaultId);
		api.setDeviceId(id);

		// --- SyncEngine construction (main.ts:387-400) ---
		const engine = new SyncEngine(
			app as unknown as import("obsidian").App,
			api,
			settings,
			async () => saveAll(),
		);
		// main.ts savePluginData: the WHOLE blob on every save, from the engine's
		// current state. A dead process saves nothing.
		const saveAll = (offlineQueue?: PersistedData["offlineQueue"]): void => {
			if (currentIncarnation()?.dead) return;
			Object.assign(
				persisted,
				structuredClone({
					lastSync: engine.getLastSync(),
					catchupSeq: engine.getCatchupSeq(),
					catchupId: engine.getCatchupId(),
					manifestSeq: engine.getManifestSeq(),
					offlineQueue: offlineQueue ?? engine.queue.persistable(),
					crdtOpQueue: crdtOpQueue.all(),
					syncState: engine.exportSyncState(),
					syncStateVaultId: engine.getSyncStateVaultId(),
					noteIds: noteIdMap.toJSON(),
					gateJournal: engine.exportGateJournal(),
				}),
			);
		};

		// --- post-construction setters, in main.ts order ---
		// `noteStream` is the mutable channel holder main.ts keeps as `this.noteStream`
		// (main.ts:1804): the setCrdtLiveCheck / CrdtOpQueue closures below read it
		// lazily, before the channel is constructed, so they see the live channel once
		// it lands. Declared here so those forward-ref closures can close over it.
		let noteStream: NoteChannel | null = null;
		engine.syncLog = new SyncLog(); // main.ts:402-403
		engine.queue.onPersist(async (entries) => saveAll(entries)); // main.ts:765
		engine.setCrdtLiveCheck(() => noteStream?.isCrdtConnected() ?? false); // main.ts:412
		engine.setNoteIdMap(noteIdMap); // main.ts:418
		engine.setDeviceId(id); // main.ts:423
		engine.setCrdtEditorDetach(() => {}); // main.ts:429 (no CrdtLiveViews headless)
		engine.setCrdtEditorRebind(() => {}); // main.ts:434

		// --- durable outbound CRDT op queue (main.ts:480-530) ---
		const crdtOpQueue = new CrdtOpQueue({
			send: makeCrdtOpSend({
				channel: () => noteStream,
				// #1409 (review H4): mirrors main.ts's wiring — without this, a
				// replayed create in the sim never exercises the genesis-frame
				// fast path, only the inline pushFile one.
				buildGenesisFrame: (path, noteId) => engine.buildGenesisFrame(path, noteId),
				onCreated: (localId, serverId, path, seeded, genesis) =>
					engine.applyCrdtCreateAck(localId, serverId, path, seeded, genesis),
				// Limit/terminal surfacing is UI (toasts) in prod — never reached against
				// the model server; keep the queue's error taxonomy wired without the UI.
				onTerminal: () => {},
			}),
			now: () => Date.now(),
		});
		crdtOpQueue.setPersist(() => saveAll()); // main.ts:866
		// main.ts drives retries off a 5 s registerInterval (main.ts:870). The sim
		// excludes perpetual intervals (they keep drain() from ever quiescing), so
		// the tick re-arms itself only while ops are waiting: a lost create or
		// delete reply is retried as in production, and an empty queue lets the
		// clock go quiet.
		let pumpArmed: number | null = null;
		const pumpQueue = (ms: number): void => {
			if (pumpArmed !== null) return;
			pumpArmed = window.setTimeout(() => {
				pumpArmed = null;
				void crdtOpQueue.tick().finally(() => {
					if (crdtOpQueue.size() > 0) pumpQueue(5000);
				});
			}, ms);
		};
		// Retry tick: main.ts drives this off a 5s registerInterval (main.ts:519).
		// The sim excludes perpetual intervals (see setInterval no-op above), so the
		// queue is instead pumped by onJoined() (on the crdt: join) plus a one-shot
		// tick scheduled after each enqueue — deterministic, and drain-quiescent.
		engine.setCrdtEnqueue((op) => {
			crdtOpQueue.enqueue({
				id: crypto.randomUUID(),
				kind: op.kind,
				docId: op.docId,
				payload: { path: op.path },
				enqueuedAt: Date.now(),
				attempts: 0,
				vaultId: settings.vaultId ?? null, // main.ts:912
			} satisfies CrdtOp);
			pumpQueue(0);
		});

		// main.ts's pending-op probes, through the same queue predicate.
		engine.setCrdtHasPendingOp((docId) =>
			crdtOpQueue.hasPending(docId, "create", settings.vaultId ?? null),
		);
		engine.setCrdtHasPendingDelete((docId) =>
			crdtOpQueue.hasPending(docId, "delete", settings.vaultId ?? null),
		);

		// --- restore data.json (main.ts onload, :916-950 and :1672) ---
		if (persisted.lastSync) engine.setLastSync(persisted.lastSync);
		if (persisted.catchupSeq !== undefined) engine.setCatchupSeq(persisted.catchupSeq);
		if (persisted.catchupId !== undefined) engine.setCatchupId(persisted.catchupId);
		if (persisted.manifestSeq !== undefined) engine.setManifestSeq(persisted.manifestSeq);
		if (persisted.offlineQueue?.length) engine.queue.load(persisted.offlineQueue);
		if (persisted.crdtOpQueue?.length) crdtOpQueue.load(persisted.crdtOpQueue);
		if (persisted.syncStateVaultId !== undefined) {
			engine.setSyncStateVaultId(persisted.syncStateVaultId);
		}
		if (persisted.syncState) engine.importSyncState(persisted.syncState);
		if (persisted.gateJournal) engine.importGateJournal(persisted.gateJournal);
		if (persisted.noteIds) noteIdMap.seed(persisted.noteIds);

		// --- connectChannel, mirroring main.ts:1666-2013 ---
		// main.ts freezes the topic userId from an awaited getMe() (main.ts:1666-1707).
		// The sim's identity is deterministic — the model /me returns a constant
		// "sim-user" for every replica — so we construct with that id directly rather
		// than a boot-time REST round-trip: awaiting getMe here would deadlock (boot
		// doesn't drive the scheduler; the test owns drain). Both replicas share the
		// id => same crdt:<user>:<vault> room, exactly as two devices on one account.
		const channel = new NoteChannel(
			settings.apiUrl,
			settings.apiKey,
			SIM_USER_ID,
			settings.vaultId,
			id, // deviceId -> the WebSocket adapter's routing key (device_id param)
		);
		noteStream = channel;

		channel.onEvent = (event) => {
			void engine.handleStreamEvent(event); // main.ts:1710-1712
		};

		let crdtEverJoined = false;
		channel.onStatusChange = (connected) => {
			if (connected) {
				engine.clearConfirmedNoteIds(); // main.ts:1734
			} else if (!crdtEverJoined) {
				engine.setCrdtManager(null); // main.ts:1757-1758
			}
			if (!connected) {
				manager.clearSynced(); // main.ts:1776
				manager.setConnected(false); // Provider model: buffer offline, don't send on a dead socket
			}
		};

		// Socket-native create/delete/catchup senders (main.ts:1815-1826). Forwards
		// b64 (#1409) so simulation runs exercise the genesis fast path too — a
		// 2-arg passthrough here silently meant no `bun test tests/sim/*` run ever
		// sent a genesis frame.
		engine.setCrdtCreate((docId, path, b64) => channel.crdtCreate(docId, path, b64));
		engine.setCrdtDelete((docId) => channel.crdtDeleteAcked(docId));
		engine.setCrdtCatchupSince((cursorSeq, limit) =>
			channel.crdtCatchupSince(cursorSeq, limit),
		);
		// Room-free full-state read (main.ts setCrdtPorts `docState`).
		engine.setCrdtPorts({ docState: (id: string) => channel.crdtDocState(id) });

		// Paths this replica has an editor open on (openNote adds, closeNote
		// removes). Backs isBound + setLiveBoundCheck below, exactly as
		// CrdtLiveViews.isBound does in production (main.ts:1912/1962).
		const boundPaths = new Set<string>();
		const hydrated = new Set<string>();
		// Forward-ref (same pattern as `noteStream` above): the onBoundUpdate flush
		// needs `manager`, which is only assigned after the wiring is built. The
		// closure is never invoked until a runtime remote-merge fires onFlushToDisk,
		// well after `boundFlush` is set below.
		let boundFlush: (path: string) => void = () => {};

		// CRDT data-plane wiring (main.ts:1875-2003 → createCrdtWiring + handlers).
		const wiring = createCrdtWiring({
			noteIdMap,
			syncEngine: engine,
			sendCrdt: (docId, frame) => channel.sendCrdt(docId, frame),
			isBound: (path) => boundPaths.has(normalizePath(path)), // main.ts:1912
			onBoundUpdate: (path) => boundFlush(path), // main.ts:1916
			canSendLive: (noteId) => engine.hasServerNote(noteId), // main.ts:1890
			// Sim seam: namespace the IndexedDB store per replica (see file header).
			dbPrefix: id,
		});
		const manager = wiring.manager;
		engine.setCrdtEnrollment(wiring.enrollment); // main.ts:1900
		// Tell the engine which paths have a live editor binding so handleModify
		// skips re-feeding disk content into the Y.Text for open notes (main.ts:1962).
		engine.setLiveBoundCheck((path) => boundPaths.has(normalizePath(path)));

		// requestSaveForBoundPath analogue (main.ts:1916 onBoundUpdate): a remote
		// merge painted into a bound note's Y.Doc, but onFlushToDisk SKIPS the disk
		// write for a bound path (the editor owns the file). Production nudges
		// Obsidian's own save pipeline (view.requestSave) to flush the bound buffer;
		// headless, we flush the projected Y.Text through the SAME
		// SyncEngine.flushFromCrdt the live-views last-release path uses. Routed
		// through a virtual timer so drain() drives it deterministically.
		boundFlush = (path: string): void => {
			window.setTimeout(() => {
				void (async () => {
					const norm = normalizePath(path);
					// Only a SEEDED (hydrated) doc may overwrite disk: until seed the
					// editor buffer (= disk) is authoritative and the Y.Text is empty —
					// flushing it would wipe the note (real requestSave writes the
					// buffer, never an empty projection).
					if (!boundPaths.has(norm) || !hydrated.has(norm)) return;
					const noteId = noteIdMap.get(path);
					if (!noteId) return;
					const text = await manager.projectedText(noteId);
					// Never wipe: a transiently-empty projection (doc reset/reopened
					// between the hydrated check and this read) must not overwrite the
					// authoritative disk content — the real editor buffer still holds it.
					if (text.length === 0) return;
					await engine.flushFromCrdt(path, text);
				})();
			}, 0);
		};
		channel.onCrdtMessage = wiring.onCrdtMessage; // main.ts:1937
		channel.onCrdtDocReady = wiring.onCrdtDocReady; // main.ts:1938
		channel.onCrdtNoteNotFound = wiring.onCrdtNoteNotFound; // main.ts:1939
		channel.onNoteYjsUpdate = wiring.onNoteYjsUpdate; // main.ts:1940

		// Deferred activation: engage CRDT routing only after the crdt: topic join is
		// server-acked (main.ts:1945-1968). Wiring it here — not the sync-topic
		// onStatusChange — is the deaf-note-race fix.
		channel.onCrdtJoined = () => {
			crdtEverJoined = true;
			engine.setCrdtManager(manager);
			// Provider model: topic joined — re-advertise every resident doc via syncStep1 and
			// flush frames buffered while offline (the reconnect convergence trigger).
			manager.setConnected(true);
			void (async () => {
				await crdtOpQueue.onJoined();
				if (crdtOpQueue.size() > 0) pumpQueue(5000);
				await onCrdtTopicJoined();
			})();
		};
		channel.onCrdtJoinError = () => {
			crdtEverJoined = false;
			engine.setCrdtManager(null);
			manager.clearSynced();
			manager.setConnected(false); // Provider model: no topic → providers offline
			wiring.enrollment.resetAll();
		};

		// Mirror of main.ts's onCrdtTopicJoined (reconnect convergence): reconcile the
		// id-map from the manifest, reset enrollments, re-enroll every open note, then
		// replay the seq op-log. reEnrollOpenCrdtNotes (main.ts:1666) re-fires a fresh
		// STEP1 for each note still open in an editor so the server re-registers this
		// device as a room observer — headless, "open" is the boundPaths set.
		async function onCrdtTopicJoined(): Promise<void> {
			try {
				await engine.reconcileNoteIdMapFromManifest();
			} catch {
				/* logged in prod; a stale map self-heals via strand-heal */
			}
			wiring.enrollment.resetAll();
			wiring.clearStrandHealAttempts();
			for (const p of boundPaths) {
				wiring.enrollment.enroll(noteIdMap.getOrMint(p));
			}
			try {
				await engine.catchupViaSeqReplay();
			} catch {
				/* resumes from the persisted cursor on the next join */
			}
			engine.retryHeldLocalEdits(); // mirror main.ts: loads the gate held
			// Mirror main.ts: kick the durable queue, which is where an edit
			// refused while unjoined was recorded (#516) — this is what delivers
			// an edit to a since-closed note.
			await engine.flushQueue();
			// main.ts runSelfHealSweep (main.ts:2645): what pushes a note created
			// while the socket was down.
			try {
				await engine.selfHealSweep();
			} catch {
				/* main.ts logs and carries on */
			}
		}

		// The engine's event handlers are gated on setReady() (main.ts calls it after
		// registerVault). The sync gate (syncBlocked) defaults open.
		engine.setReady();

		void channel.connect(); // main.ts:2013

		// A restart runs main.ts's layout-ready startup (main.ts:1316-1430): map
		// reconcile + gate replay, the cold-start reconcile of notes edited while
		// the app was closed, then pushModifiedFiles. Fired, like every chain
		// here; the caller's drain completes it.
		if (opts.restart) {
			void (async () => {
				try {
					await engine.reconcileNoteIdMapFromManifest();
				} catch {
					/* offline startup: main.ts logs and carries on */
				}
				await engine.replayGateJournal();
				for (const file of app.vault.getMarkdownFiles()) {
					const noteId = noteIdMap.getOrMint(file.path);
					const diskContent = await app.vault.cachedRead(file);
					if (!engine.needsColdReconcile(file.path, diskContent)) continue;
					void reconcileColdStart(
						{
							path: file.path,
							noteId,
							diskContent,
							reread: () => app.vault.cachedRead(file),
						},
						{
							applyLocalEdit: manager.applyLocalEdit.bind(manager),
							getText: manager.getText.bind(manager),
							projectedText: manager.projectedText.bind(manager),
							enroll: (nid) => {
								if (boundPaths.has(normalizePath(file.path)))
									wiring.enrollment.enroll(nid);
							},
						},
						() => {},
					).catch(() => {});
				}
				if (channel.isCrdtConnected()) await engine.catchupViaSeqReplay();
				await engine.pushModifiedFiles();
			})().catch(() => {});
		}

		// main.ts onunload, the parts that touch sync state (:1531-1576).
		const onUnload = (): void => {
			saveAll();
			crdtOpQueue.dispose();
			engine.destroy();
			noteIdMap.flushNow();
			channel.disconnect();
			void manager.destroyAll();
		};

		return new Replica({
			id,
			engine,
			vaultDir,
			noteIdMap,
			crdtManager: manager,
			app,
			channel,
			enrollment: wiring.enrollment,
			boundPaths,
			hydrated,
			inc,
			persisted,
			server,
			onUnload,
			// Only when disk holds nothing unsynced. A disk write still inside the
			// modify debounce would be overwritten by this paint (the binding's
			// bind-time "adopt"); whether the real binding drops such a write is
			// not something this editor stand-in can settle, so it stays out.
			flushBound: (path) => {
				const file = app.vault.getFileByPath(path);
				if (!file) return;
				void app.vault
					.read(file)
					.then((disk) => {
						if (!engine.needsColdReconcile(path, disk)) boundFlush(path);
					})
					.catch(() => {});
			},
		});
	}

	// ------------------------------------------------------------------------
	// Ops: perform the vault mutation; the wired VaultEvents fire the engine
	// handler synchronously (which schedules a virtual-timer push). The caller
	// drives scheduler.drain() to converge.
	// ------------------------------------------------------------------------

	async createNote(path: string, content: string): Promise<void> {
		await this.app.vault.create(path, content);
	}

	async createAttachment(path: string, bytes: Uint8Array): Promise<void> {
		await this.app.vault.createBinary(path, bytes.slice().buffer);
	}

	/** Open a note in an editor: makes isBound(path) true and fires the real
	 *  STEP1 enrollment (main.ts:623 active-leaf-change → enroll(getOrMint(path))),
	 *  so the note pulls remote CRDT history and becomes history-FULL. A real user
	 *  must open a note before editing it; the random workload mirrors that.
	 *
	 *  Also arms the deferUntilSeeded gate: a doc that already carries history (a
	 *  locally-created note) is editable at once; a history-less one (received via
	 *  catch-up, disk-only) becomes editable only once STEP2 seeds it — matching
	 *  EditorController.bindTo, which defers its binding until the doc is seeded. */
	async openNote(path: string): Promise<void> {
		const norm = normalizePath(path);
		this.boundPaths.add(norm);
		this.dirty.delete(norm);
		const id = this.noteIdMap.getOrMint(path);
		this.enrollment.enroll(id);
		const file = this.app.vault.getFileByPath(path);
		// live-binding.ts attach: the editor text as opened is the merge base for
		// keystrokes typed before the binding goes live (`preEditText`).
		const preEdit = file ? await this.app.vault.read(file) : null;
		// Fire-and-forget (scheduler-driven, like every CRDT op here): once the
		// doc is ready, run the binding's initial reconcile; an unseeded doc
		// defers until its first seed (or the load gate opening). Deterministic:
		// the seed arrives on a scheduled frame that drain() delivers in order.
		void (async () => {
			const text = (await this.crdtManager.getDoc(id)).getText("content");
			if (!this.boundPaths.has(norm)) return;
			if (text.length > 0) {
				await this.reconcileBound(path, id, false, preEdit);
				return;
			}
			// deferSeed: a gated doc (the load gate holds it) resolves with the
			// gate's merge on arrival, an ungated one with the plain reconcile.
			const gated = this.crdtManager.awaitsServerState(id);
			let unsubGate: () => void = () => {};
			const onSeed = (): void => {
				if (text.length === 0) return;
				text.unobserve(onSeed);
				unsubGate();
				if (this.boundPaths.has(norm)) void this.reconcileBound(path, id, gated, preEdit);
			};
			text.observe(onSeed);
			// When the server state holds no structs the load gate opens instead of
			// a seed arriving, and the binding forwards the editor buffer (here,
			// disk) straight into the Y.Text (applyAndGoLive "forward"), NOT via
			// applyLocalEdit: that treats a buffer equal to the recorded baseline as
			// "no input" and sends nothing, which left the sim's row empty where
			// real Obsidian seeds it (e2e 40248570109).
			if (!gated) return;
			unsubGate = this.crdtManager.onLoadGateOpen(id, () => {
				text.unobserve(onSeed);
				if (!this.boundPaths.has(norm)) return;
				this.hydrated.add(norm);
				const file = this.app.vault.getFileByPath(path);
				if (!file) return;
				// Straight into the Y.Text with the binding as origin (applyAndGoLive
				// "forward"), NOT applyLocalEdit: that treats a buffer equal to the
				// recorded baseline as "no input" and sends nothing, which left the
				// sim's row empty where real Obsidian seeds it (e2e 40248570109,
				// green on the same lost-create-then-open shape).
				void this.app.vault
					.read(file)
					.then(async (buffer) => {
						const doc = await this.crdtManager.getDoc(id);
						const body = doc.getText("content");
						if (body.length > 0 || buffer.length === 0) return;
						doc.transact(() => body.insert(0, buffer), BINDING_ORIGIN);
					})
					.catch(() => {});
			});
		})().catch(() => {});
	}

	/** The binding's initial reconcile, with the REAL decision functions
	 *  (live-binding-decisions.ts): `decideReconcile` for a doc that was
	 *  already seeded or that seeded ungated, `decideLoadedReconcile` (merge3
	 *  from `loadMergeBase`, else one conflict copy) for a doc the load gate
	 *  held. The editor buffer is disk: it holds the file as opened plus any
	 *  keystrokes typed before the binding went live (`dirty`). Afterwards the
	 *  note is live: keystrokes go straight into the Y.Text (editNote). */
	private async reconcileBound(
		path: string,
		id: string,
		gated: boolean,
		preEdit: string | null,
	): Promise<void> {
		const norm = normalizePath(path);
		const file = this.app.vault.getFileByPath(path);
		const { text } = this.crdtManager.residentText(id);
		if (!file || !text.doc) return;
		const editorText = await this.app.vault.read(file);
		if (!this.boundPaths.has(norm) || frontmatterPrefixLen(editorText) > 0) return;
		const docText = text.toJSON();
		const toDoc = (changes: { from: number; to: number; insert: string }[]) =>
			text.doc?.transact(
				() =>
					applyCmChangesToYText(
						text,
						changes.map((c) => ({ fromA: c.from, toA: c.to, insert: c.insert })),
					),
				BINDING_ORIGIN,
			);
		const goLive = () => {
			this.hydrated.add(norm);
			this.dirty.delete(norm);
		};
		if (gated) {
			const base = await this.engine
				.loadMergeBase(path, this.crdtManager.residentProjection(id))
				.catch(() => null);
			const action = decideLoadedReconcile(editorText, text.toJSON(), base);
			if (action.kind === "conflict") {
				// The note takes the server's text, the editor's goes to a copy.
				const server = text.toJSON();
				goLive();
				await this.app.vault.modify(file, server);
				if (!(await this.engine.keepConflictCopy(path, editorText))) {
					await this.engine.restoreLocalText(path, editorText);
				}
				return;
			}
			if (action.kind === "merge") toDoc(action.toDoc);
			goLive();
			if (action.kind !== "noop") await this.app.vault.modify(file, text.toJSON());
			return;
		}
		const action = decideReconcile(editorText, docText, this.dirty.has(norm), preEdit);
		if (action.kind === "defer") return;
		if (action.kind === "forward") toDoc(action.changes);
		else if (action.kind === "merge") toDoc(action.toDoc);
		goLive();
		// adopt / merge: the editor now shows the doc, and autosave writes it.
		if (action.kind === "adopt" || action.kind === "merge") {
			await this.app.vault.modify(file, text.toJSON());
		}
	}

	/** Close the editor: flush the projected Y.Text to disk and free the doc
	 *  (mirrors CrdtLiveViews.onLastViewerRelease), then drop the binding. The
	 *  flush awaits IndexedDB, which only the scheduler drives, so — like every
	 *  other CRDT op in this tier — it is FIRED and the caller's drain() completes
	 *  it (awaiting it here without a drain would deadlock the virtual clock). */
	async closeNote(path: string): Promise<void> {
		const norm = normalizePath(path);
		if (!this.boundPaths.has(norm)) return;
		this.boundPaths.delete(norm);
		const wasHydrated = this.hydrated.delete(norm);
		const noteId = this.noteIdMap.get(path);
		if (!noteId) return;
		void (async () => {
			// Only flush a seeded doc (see boundFlush), and NEVER write an empty
			// projection over disk (a transient reset would otherwise wipe the note —
			// the real editor buffer still holds the content across a close).
			if (wasHydrated) {
				const text = await this.crdtManager.projectedText(noteId);
				if (text.length > 0) await this.engine.flushFromCrdt(path, text);
			}
			this.crdtManager.closeDoc(noteId);
		})().catch(() => {});
	}

	/** Edit a note. `next` is the new text, or a function from the text the
	 *  user SEES to the new text: the doc's text for an open note (the binding
	 *  paints remote merges into the editor live), disk for a closed one.
	 *  Resolves false only when `next` declined. Keystrokes into an open note
	 *  whose binding is not live yet queue in the editor buffer and are
	 *  resolved by the binding's initial reconcile (reconcileBound). */
	async editNote(
		path: string,
		next: string | ((current: string) => string | null),
	): Promise<boolean> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) throw new Error(`editNote: no file at ${path}`);
		const norm = normalizePath(path);
		if (this.boundPaths.has(norm)) {
			// deferUntilSeeded: the real editor does NOT forward a keystroke into a
			// history-less doc (it would seed a second lineage, the doubling).
			if (!this.hydrated.has(norm)) {
				// Not live yet: the keystrokes queue in the editor buffer (disk here)
				// and the binding's initial reconcile resolves them (dirty).
				const disk = await this.app.vault.read(file);
				const typed = typeof next === "function" ? next(disk) : next;
				if (typed === null) return false;
				this.dirty.add(norm);
				await this.app.vault.modify(file, typed);
				return true;
			}
			const noteId = this.noteIdMap.getOrMint(path);
			const { text } = this.crdtManager.residentText(noteId);
			const current = text.toJSON();
			const target = typeof next === "function" ? next(current) : next;
			if (target === null) return false;
			// The keystrokes go straight into the Y.Text with the binding as the
			// transaction origin, exactly as live-binding.ts forwards a CM6 change
			// (`doc.transact(() => applyCmChangesToYText(...), this)`). NOT through
			// applyLocalEdit: its load gate and "disk equals baseline means no
			// input" rule belong to the disk path, not the editor, and a stand-in
			// that differs from the binding is what produced bug 4's false alarm.
			// Body only: the binding drops edits inside a frontmatter block.
			if (frontmatterPrefixLen(target) === 0 && text.doc) {
				const changes = textDiffToChangeSpec(current, target).map((c) => ({
					fromA: c.from,
					toA: c.to,
					insert: c.insert,
				}));
				text.doc.transact(() => applyCmChangesToYText(text, changes), BINDING_ORIGIN);
			}
			// Obsidian's autosave writes the editor buffer to disk (~2s); that
			// modify hits the bound short-circuit (sync.ts:1982), never re-pushes.
			await this.app.vault.modify(file, target);
			return true;
		}
		const disk = await this.app.vault.read(file);
		const target = typeof next === "function" ? next(disk) : next;
		if (target === null) return false;
		await this.app.vault.modify(file, target);
		return true;
	}

	async renameNote(oldPath: string, newPath: string): Promise<void> {
		const file = this.app.vault.getFileByPath(oldPath);
		if (!file) throw new Error(`renameNote: no file at ${oldPath}`);
		await this.app.vault.rename(file, newPath);
	}

	async renameFolder(oldPath: string, newPath: string): Promise<void> {
		await this.app.vault.renameFolder(oldPath, newPath);
	}

	/** Delete a file of any kind (a note or an attachment) to the trash. */
	async deleteFile(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (file) await this.app.fileManager.trashFile(file);
	}

	async deleteNote(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) throw new Error(`deleteNote: no file at ${path}`);
		await this.app.fileManager.trashFile(file);
	}

	/** Drop the live channel. Y.Doc + IndexedDB retain edits offline; the
	 *  reconnect handshake + seq-replay deliver them (main.ts onStatusChange). */
	async goOffline(): Promise<void> {
		this.channel.disconnect();
	}

	async goOnline(): Promise<void> {
		await this.channel.connect();
	}

	async fullSync(): Promise<void> {
		await this.engine.fullSync();
	}

	/** Paths open in an editor on this device. */
	openPaths(): string[] {
		return [...this.boundPaths];
	}

	isOpen(path: string): boolean {
		return this.boundPaths.has(normalizePath(path));
	}

	/** Run `fn` as this device process (process.ts), so everything it starts
	 *  belongs to it. Every sim op on a device goes through here. */
	run<T>(fn: () => T): T {
		return runAs(this.inc, fn);
	}

	/** The process is killed (force-quit, crash, OS kill): nothing it held in
	 *  memory is saved, nothing it scheduled runs. IndexedDB and data.json keep
	 *  whatever they last held. The server times the socket out. */
	kill(): void {
		// The path -> note_id map lives in the index-room Y.Doc in production
		// (main.ts makeNoteIdMap), persisted to IndexedDB per change, not only
		// when data.json is saved. The sim's map is in memory, so carry it as
		// IndexedDB would have.
		this.persisted.noteIds = this.noteIdMap.toJSON();
		this.inc.dead = true;
		liveSockets.get(this.inc)?.dropFromNetwork(false);
	}

	/** main.ts onunload (quit / reload): save, tear the stack down. The caller
	 *  drains so destroyAll's IndexedDB flush lands, then kills and reboots. */
	quit(): void {
		this.run(() => this.onUnload());
	}

	/** The network under the socket died: the server forgets it, the client
	 *  sees an unclean close and runs its own reconnect. */
	dropNetwork(): void {
		this.run(() => liveSockets.get(this.inc)?.dropFromNetwork(true));
	}

	/** iOS backgrounding: the visibilitychange "hidden" flushes run (main.ts
	 *  :1030-1040), then the JS context freezes. The OS kills the socket; the
	 *  server times it out, the client is not told. */
	suspend(): void {
		if (this.inc.frozen) return;
		this.run(() => {
			this.engine.flushHealRoomCounts();
			void this.crdtManager.flushAcked();
		});
		this.inc.frozen = true;
		liveSockets.get(this.inc)?.dropFromNetwork(false);
	}

	/** Foreground again: timers resume, requests that were in flight fail, and
	 *  main.ts calls channel.onResume (probe the socket, close it if dead). */
	resume(): void {
		if (!this.inc.frozen) return;
		this.inc.frozen = false;
		for (const fail of parkedFor(this.inc).splice(0)) fail();
		this.run(() => this.channel.onResume());
	}
}

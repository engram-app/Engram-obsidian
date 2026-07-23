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
import { makeCrdtOpSend } from "../../src/crdt-op-dispatch";
import { type CrdtOp, CrdtOpQueue } from "../../src/crdt-op-queue";
import type { CrdtEnrollment } from "../../src/crdt/enrollment";
import type { CrdtManager } from "../../src/crdt/manager";
import { NoteIdMap } from "../../src/crdt/note-id-map";
import { createCrdtWiring } from "../../src/crdt/wiring";
import { SyncEngine } from "../../src/sync";
import { SyncLog } from "../../src/sync-log";
import { DEFAULT_SETTINGS, type EngramSyncSettings } from "../../src/types";
import { TFile, TFolder, requestUrl as baseRequestUrl, normalizePath } from "../__mocks__/obsidian";
import type { SimClock } from "./clock";
import type { ModelServer } from "./model-server";
import { setRequestUrlHandler, requestUrl as shimRequestUrl } from "./obsidian-shim";
import type { Scheduler } from "./scheduler";
import { type SimApp, type VaultEvents, type WriteJournalEntry, makeVault } from "./vault-fs";

let requestUrlRedirected = false;

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

	constructor(url: string) {
		const clientId = new URL(url).searchParams.get("device_id");
		if (!clientId) throw new Error(`SimWebSocket: no device_id in ${url}`);
		const reg = socketRegistry.get(clientId);
		if (!reg) throw new Error(`SimWebSocket: no server registered for client ${clientId}`);
		this.clientId = clientId;
		this.reg = reg;
		this.sock = reg.server.connect(clientId);
		this.sock.onmessage = (raw: string) => this.onmessage?.({ data: raw });
		reg.scheduler.enqueue(`ws-open:${clientId}`, () => {
			this.readyState = SimWebSocket.OPEN;
			this.onopen?.();
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
			this.onclose?.({ code: 1000, reason: "", wasClean: true });
		});
	}
}

export interface ReplicaBootOpts {
	id: string;
	server: ModelServer;
	scheduler: Scheduler;
	clock: SimClock;
	/** Shared root; the replica's vault lives at `${rootDir}/${id}`. */
	rootDir: string;
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
	readonly crdtManager: CrdtManager;

	private readonly app: SimApp;
	private readonly channel: NoteChannel;
	private readonly enrollment: CrdtEnrollment;
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

	private constructor(args: {
		id: string;
		engine: SyncEngine;
		vaultDir: string;
		noteIdMap: NoteIdMap;
		crdtManager: CrdtManager;
		app: SimApp;
		channel: NoteChannel;
		enrollment: CrdtEnrollment;
		boundPaths: Set<string>;
		hydrated: Set<string>;
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
		const { id, server, scheduler, clock, rootDir } = opts;

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
			(globalThis as unknown as { setImmediate: (fn: () => void) => number }).setImmediate = (
				fn: () => void,
			) => clock.setTimeout(fn, 0);
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
					scheduler.enqueue(`http:${id}`, () => {
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
		// (resolvable at event time — onDelete fires before removal). See vault-fs
		// VaultEvents docstring: main.ts:575-578 / 852-857 / 609-614 / 618-619.
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
			onDelete: (p) => {
				const f = app.vault.getAbstractFileByPath(p);
				if (f instanceof TFolder)
					void engine.handleFolderDelete(f); // main.ts:610-611
				else if (f instanceof TFile) void engine.handleDelete(f); // main.ts:613
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
			async () => {
				// saveData: persistence is a no-op in the sim (no data.json). The engine
				// mutates the shared noteIdMap instance directly, which the test reads.
			},
		);

		// --- post-construction setters, in main.ts order ---
		// `noteStream` is the mutable channel holder main.ts keeps as `this.noteStream`
		// (main.ts:1804): the setCrdtLiveCheck / CrdtOpQueue closures below read it
		// lazily, before the channel is constructed, so they see the live channel once
		// it lands. Declared here so those forward-ref closures can close over it.
		let noteStream: NoteChannel | null = null;
		engine.syncLog = new SyncLog(); // main.ts:402-403
		engine.setCrdtLiveCheck(() => noteStream?.isCrdtConnected() ?? false); // main.ts:412
		engine.setNoteIdMap(noteIdMap); // main.ts:418
		engine.setDeviceId(id); // main.ts:423
		engine.setCrdtEditorDetach(() => {}); // main.ts:429 (no CrdtLiveViews headless)
		engine.setCrdtEditorRebind(() => {}); // main.ts:434

		// --- durable outbound CRDT op queue (main.ts:480-530) ---
		const crdtOpQueue = new CrdtOpQueue({
			send: makeCrdtOpSend({
				channel: () => noteStream,
				onCreated: (localId, serverId, path) =>
					engine.applyCrdtCreateAck(localId, serverId, path),
				// Limit/terminal surfacing is UI (toasts) in prod — never reached against
				// the model server; keep the queue's error taxonomy wired without the UI.
				onTerminal: () => {},
			}),
			now: () => Date.now(),
		});
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
			} satisfies CrdtOp);
			window.setTimeout(() => void crdtOpQueue.tick(), 0);
		});

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
			true, // CRDT topic join — always on (setting removed; ctor param is a test seam)
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
			if (!connected) manager.clearSynced(); // main.ts:1776
		};

		// Socket-native create/delete/catchup senders (main.ts:1815-1826).
		engine.setCrdtCreate((docId, path) => channel.crdtCreate(docId, path));
		engine.setCrdtCreateBatch((creates) => channel.crdtCreateBatch(creates));
		engine.setCrdtDelete((docId) => channel.crdtDeleteAcked(docId));
		engine.setCrdtCatchupSince((cursorSeq, limit) =>
			channel.crdtCatchupSince(cursorSeq, limit),
		);

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
			void (async () => {
				await crdtOpQueue.onJoined();
				await onCrdtTopicJoined();
			})();
		};
		channel.onCrdtJoinError = () => {
			crdtEverJoined = false;
			engine.setCrdtManager(null);
			manager.clearSynced();
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
		}

		// The engine's event handlers are gated on setReady() (main.ts calls it after
		// registerVault). The sync gate (syncBlocked) defaults open.
		engine.setReady();

		void channel.connect(); // main.ts:2013

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
		const id = this.noteIdMap.getOrMint(path);
		this.enrollment.enroll(id);
		// Fire-and-forget (scheduler-driven, like every CRDT op here): mark the
		// note hydrated now if the Y.Text already has content, else once its first
		// non-empty seed lands. Deterministic — the seed arrives via a scheduled
		// STEP2 frame that drain() delivers in seed order.
		void (async () => {
			const text = (await this.crdtManager.getDoc(id)).getText("content");
			if (text.length > 0) {
				this.hydrated.add(norm);
				return;
			}
			const onSeed = (): void => {
				if (text.length > 0) {
					this.hydrated.add(norm);
					text.unobserve(onSeed);
				}
			};
			text.observe(onSeed);
		})().catch(() => {});
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

	async editNote(path: string, content: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) throw new Error(`editNote: no file at ${path}`);
		if (this.boundPaths.has(normalizePath(path))) {
			// deferUntilSeeded: the real editor does NOT forward a keystroke into a
			// history-less doc (it would seed a second lineage → doubling). Until the
			// server seeds this note's Y.Doc, the edit is buffered in the editor, not
			// yet on the wire. Model that by dropping the edit here — a later edit
			// (after hydration) forwards convergently. NEVER touch disk without the
			// Y.Text, or the bound path would drift from its authoritative doc.
			if (!this.hydrated.has(normalizePath(path))) return;
			// Live-editor edit: the y-codemirror.next binding would stream keystrokes
			// into the Y.Text; headless, feed the whole content through the SAME
			// manager method routeModify drives (the one editor stand-in, see header).
			// handleModify short-circuits the disk-driven CRDT route for a bound path
			// (sync.ts:1982), so the Y.Text is the ONLY inbound edit channel here.
			// FIRED not awaited: applyLocalEdit awaits IndexedDB (scheduler-driven);
			// awaiting it before the caller drains would freeze the virtual clock. The
			// real binding applies to Y.Text synchronously too — only persistence is
			// async, and drain() completes it deterministically.
			// Surface (don't swallow) an apply/persist failure: a systemically
			// dropped edit would otherwise read as trivial oracle AGREEMENT (both
			// replicas never see it), the one blind spot the convergence check
			// can't catch on its own. Fires only on the error path — silent green.
			void this.crdtManager
				.applyLocalEdit(this.noteIdMap.getOrMint(path), content)
				.catch((err) =>
					console.warn(`SIM editNote applyLocalEdit failed for ${path}:`, err),
				);
			// Obsidian's autosave still writes the editor buffer to disk (~2s); that
			// modify event hits the bound short-circuit above and never re-pushes.
			await this.app.vault.modify(file, content);
			return;
		}
		await this.app.vault.modify(file, content);
	}

	async renameNote(oldPath: string, newPath: string): Promise<void> {
		const file = this.app.vault.getFileByPath(oldPath);
		if (!file) throw new Error(`renameNote: no file at ${oldPath}`);
		await this.app.vault.rename(file, newPath);
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
}

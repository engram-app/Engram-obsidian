// tests/sim/fuzz-world.ts
//
// SEEDED PROPERTY-BASED SYNC FUZZ. Two or three devices run the REAL plugin
// sync stack (SyncEngine, ProviderRegistry with its persisted acked marks, the
// idle heal-room pool, the durable queues) against the model server, and a
// seeded op stream tries to break it: local edits (idle and in an open
// editor), remote (MCP) edits, renames, folder renames, deletes, MCP
// restores, offline periods, network drops, iOS-style suspend/resume, hard
// restarts and crashes (in-memory state gone, IndexedDB and data.json kept),
// lost/duplicated/reordered frames, server rollbacks to an earlier snapshot,
// and attachment adds and deletes.
//
// At quiescence it checks:
//   converge    every device's disk equals the server, per note and attachment
//   structure   no duplicated or interleaved text: each note keeps its exact
//               line skeleton and one header (one encoder, every lineage once)
//   lost-edit   every slot holds the last value its writer gave it (an edit is
//               only gone if a later op legitimately removed it)
//   duplicate   one live note per logical note, no conflict copy unless the
//               run injected a real concurrent conflict on that note
//   delete      deleted notes stay deleted unless restored; restored ones exist
//   doc         a device's loaded Y.Doc equals the server text
//   rooms       idle handshake room starts stay within the per-device budget
//               (burst 5 + 15/min: at most 20 in any 60 s), at most 4 idle
//               handshake rooms open at once
//   liveness    the heal pool drains (no note waits for a heal forever), and
//               the scheduler quiesces at all
//
// Each note is a fixed skeleton of slot lines separated by fences, and each
// device only ever writes its OWN slot (S is the server's, X is the shared
// slot a deliberate conflict uses). Concurrent edits therefore never collide
// textually: any duplication, interleaving or conflict copy is a sync bug, and
// the expected final text is exact.
//
// Seeds: SIM_SEEDS (default 200) seeds from SIM_SEED_BASE (default 1); SIM_SEED
// replays one. SIM_OPS sets ops per seed. A failure prints the seed, the
// invariant and a shrunk op trace. The nightly soak (sim-soak.yml) runs
// SIM_SEEDS=5000.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SimClock } from "./clock";
import { ModelServer } from "./model-server";
import { mulberry32 } from "./prng";
import { Replica } from "./replica";
import { Scheduler } from "./scheduler";

const OPS = Number(process.env.SIM_OPS ?? 40);
const LETTERS = ["A", "B", "C"];
const SLOTS = ["A", "B", "C", "S", "X"];
const MAX_NOTES = 8;
const MAX_ATTACHMENTS = 3;
/** Engram#2242 client budget: HEAL_ROOM_BURST + HEAL_ROOMS_PER_MINUTE. */
const ROOM_STARTS_PER_MINUTE = 5 + 15;
/** IDLE_HEAL_ROOMS. */
const IDLE_ROOMS_AT_ONCE = 4;

// --- ops -------------------------------------------------------------------

type OpKind =
	| "create"
	| "edit"
	| "editOpen"
	| "open"
	| "close"
	| "remoteEdit"
	| "rename"
	| "folderRename"
	| "delete"
	| "serverDelete"
	| "restore"
	| "offline"
	| "online"
	| "blip"
	| "suspend"
	| "resume"
	| "restart"
	| "crash"
	| "lostReply"
	| "dupFrame"
	| "reorder"
	| "lostRequest"
	| "lostFrame"
	| "snapshot"
	| "rollback"
	| "conflict"
	| "attachAdd"
	| "attachDelete"
	| "attachServerDelete"
	| "bulkCreate"
	| "bulkRemoteEdit";

export interface Op {
	kind: OpKind;
	/** Device index. */
	d: number;
	/** Second device (conflict). */
	d2: number;
	/** Logical note / attachment index. */
	n: number;
	/** Free choice (folder, name). */
	x: number;
	/** Scheduler steps run after the op, so deliveries overlap later ops. */
	steps: number;
}

const ALL_WEIGHTS: [OpKind, number][] = [
	["create", 6],
	["edit", 16],
	["editOpen", 12],
	["open", 6],
	["close", 3],
	["remoteEdit", 6],
	["rename", 4],
	["folderRename", 2],
	["delete", 1],
	["serverDelete", 1],
	["restore", 2],
	["offline", 3],
	["online", 4],
	["blip", 3],
	["suspend", 2],
	["resume", 3],
	["restart", 2],
	["crash", 2],
	["lostReply", 2],
	["dupFrame", 2],
	["reorder", 3],
	["lostRequest", 1],
	["lostFrame", 2],
	["snapshot", 2],
	["rollback", 2],
	["conflict", 1],
	["attachAdd", 2],
	["attachDelete", 1],
	["attachServerDelete", 1],
	["bulkCreate", 1],
	["bulkRemoteEdit", 2],
];

/** A bulk import: this many notes at once (t100...), enough idle notes to
 *  push the heal-room pool and its start budget. */
const BULK_NOTES = 30;
/** SIM_EXCLUDE=kind,kind drops op kinds from the mix (to explore around a
 *  known failure class). */
const EXCLUDED = new Set((process.env.SIM_EXCLUDE ?? "").split(",").filter(Boolean));
const WEIGHTS = ALL_WEIGHTS.filter(([k]) => !EXCLUDED.has(k));
const WEIGHT_SUM = WEIGHTS.reduce((s, [, w]) => s + w, 0);

/** The op stream is a pure function of the seed, generated up front from its
 *  own PRNG (the scheduler's PRNG decides delivery order). Ops name targets
 *  logically (device index, note index) and resolve against live state when
 *  they run, so any subset of a stream is still a valid stream: that is what
 *  lets the shrinker delete ops. */
export function genOps(seed: number): { nDev: number; ops: Op[] } {
	const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
	const int = (k: number) => Math.floor(rand() * k);
	const nDev = 2 + int(2);
	const ops: Op[] = [];
	// Targets are drawn from what the stream has created so far, so most ops
	// hit something; a shrunk stream that lost the create just skips them.
	let notes = 0;
	let attachments = 0;
	const initial = 2 + int(2);
	for (; notes < initial; notes++) {
		ops.push({ kind: "create", d: int(nDev), d2: 0, n: notes, x: int(3), steps: int(4) });
	}
	for (let i = 0; i < OPS; i++) {
		let r = rand() * WEIGHT_SUM;
		let kind: OpKind = "edit";
		for (const [k, w] of WEIGHTS) {
			r -= w;
			if (r < 0) {
				kind = k;
				break;
			}
		}
		let n: number;
		if (kind === "create") {
			if (notes >= MAX_NOTES) kind = "edit";
			n = kind === "create" ? notes++ : int(notes);
		} else if (kind === "attachAdd") {
			n = attachments < MAX_ATTACHMENTS ? attachments++ : int(MAX_ATTACHMENTS);
		} else if (kind.startsWith("attach")) {
			n = int(Math.max(1, attachments));
		} else n = int(notes);
		const d = int(nDev);
		ops.push({ kind, d, d2: (d + 1 + int(nDev - 1)) % nDev, n, x: int(1000), steps: int(7) });
	}
	return { nDev, ops };
}

export function fmtOp(op: Op): string {
	const dev = (i: number) => LETTERS[i] ?? `?${i}`;
	switch (op.kind) {
		case "conflict":
			return `conflict(t${op.n}, ${dev(op.d)} offline vs ${dev(op.d2)})`;
		case "remoteEdit":
		case "serverDelete":
		case "restore":
		case "snapshot":
		case "rollback":
			return `${op.kind}(t${op.n})`;
		case "attachServerDelete":
			return `${op.kind}(a${op.n})`;
		case "attachAdd":
		case "attachDelete":
			return `${op.kind}(${dev(op.d)}, a${op.n})`;
		case "create":
		case "edit":
		case "editOpen":
		case "open":
		case "close":
		case "rename":
		case "delete":
			return `${op.kind}(${dev(op.d)}, t${op.n})`;
		default:
			return `${op.kind}(${dev(op.d)})`;
	}
}

// --- note bodies -------------------------------------------------------------

const header = (n: number) => `# t${n}`;
const skeleton = (n: number) => `${header(n)}\n${SLOTS.map((s) => `${s}: -`).join("\n--\n")}\n`;
const SLOT_LINE = (slot: string) => new RegExp(`^${slot}: (.*)$`, "m");

function setSlot(body: string, slot: string, value: string): string | null {
	const re = SLOT_LINE(slot);
	return re.test(body) ? body.replace(re, `${slot}: ${value}`) : null;
}

/** The body's slot values, or null when the skeleton is broken (a line
 *  doubled, interleaved, lost or extra). */
function parseBody(n: number, body: string): Record<string, string> | null {
	const lines = body.split("\n");
	const want = skeleton(n).split("\n");
	if (lines.length !== want.length || lines[0] !== header(n)) return null;
	const out: Record<string, string> = {};
	for (let i = 1; i < want.length; i++) {
		const w = want[i];
		const l = lines[i];
		if (w === "--" || w === "") {
			if (l !== w) return null;
			continue;
		}
		const slot = w.slice(0, w.indexOf(":"));
		const m = /^([A-Z]): (\S+)$/.exec(l);
		if (!m || m[1] !== slot) return null;
		out[slot] = m[2];
	}
	return out;
}

function noteNumber(body: string): number | null {
	const m = /^# t(\d+)\n/.exec(body);
	return m ? Number(m[1]) : null;
}

const isConflictCopy = (p: string) => p.includes("(conflict");

// --- world -------------------------------------------------------------------

interface LogicalNote {
	created: boolean;
	deleted: boolean;
	/** Server id, learned once the note is on the server. */
	id: string | null;
	/** Expected slot values. */
	slots: Record<string, string>;
	/** Every value each slot has ever been given (a rollback may roll a slot
	 *  back to an older one). */
	history: Record<string, Set<string>>;
	/** A real concurrent conflict was injected: copies and a merged X allowed. */
	conflict: boolean;
	/** The server was rolled back: server-authored (S) ops may be gone. */
	rolledBack: boolean;
}

export interface Violation {
	invariant: string;
	detail: string;
}

class Fail extends Error {
	constructor(readonly v: Violation) {
		super(`${v.invariant}: ${v.detail}`);
	}
}

export class World {
	readonly clock = new SimClock();
	readonly scheduler: Scheduler;
	readonly server: ModelServer;
	readonly rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-fuzz-"));
	devs: Replica[] = [];
	readonly notes = new Map<number, LogicalNote>();
	readonly offline = new Set<number>();
	readonly suspended = new Set<number>();
	readonly needsBlip = new Set<number>();
	readonly attachments = new Map<number, { path: string; deleted: boolean }>();
	readonly snaps = new Map<number, Uint8Array>();
	readonly trace: string[] = [];
	/** Idle handshake room start times, per device process. */
	private readonly roomStarts = new Map<string, number[]>();
	violation: Violation | null = null;
	private opIndex = 0;

	constructor(readonly seed: number) {
		this.scheduler = new Scheduler(seed, this.clock);
		this.server = new ModelServer({ scheduler: this.scheduler, now: () => this.clock.now() });
		this.server.onRoomStart = (clientId, docId, handshake) =>
			this.onRoomStart(clientId, docId, handshake);
	}

	async boot(nDev: number): Promise<void> {
		for (let i = 0; i < nDev; i++) {
			this.devs.push(
				await Replica.boot({
					id: LETTERS[i],
					server: this.server,
					scheduler: this.scheduler,
					clock: this.clock,
					rootDir: this.rootDir,
				}),
			);
		}
		await this.drain();
	}

	fail(invariant: string, detail: string): never {
		const v = { invariant, detail };
		this.violation ??= v;
		throw new Fail(v);
	}

	// --- room budget (checked as it happens) ---------------------------------

	private idleRoom(clientId: string, docId: string): boolean {
		const r = this.devs.find((x) => x.id === clientId);
		const p = r?.noteIdMap.pathForId(docId);
		return !(r && p && r.isOpen(p));
	}

	private onRoomStart(clientId: string, docId: string, handshake: boolean): void {
		if (!handshake || !this.idleRoom(clientId, docId)) return;
		const r = this.devs.find((x) => x.id === clientId);
		const key = `${clientId}#${r?.inc.n ?? 0}`;
		const now = this.clock.now();
		const times = (this.roomStarts.get(key) ?? []).filter((t) => now - t < 60_000);
		times.push(now);
		this.roomStarts.set(key, times);
		if (times.length > ROOM_STARTS_PER_MINUTE && !this.violation) {
			this.violation = {
				invariant: "rooms/rate",
				detail: `${clientId} started ${times.length} idle handshake rooms within 60 s (budget ${ROOM_STARTS_PER_MINUTE}) at t=${now}ms`,
			};
		}
	}

	private checkOpenRooms(): void {
		if (this.violation) return;
		for (const r of this.devs) {
			const idle = this.server
				.openRooms(r.id)
				.filter((room) => room.handshake && this.idleRoom(r.id, room.docId));
			if (idle.length > IDLE_ROOMS_AT_ONCE) {
				this.violation = {
					invariant: "rooms/open",
					detail: `${r.id} holds ${idle.length} idle handshake rooms open at once (cap ${IDLE_ROOMS_AT_ONCE}) at t=${this.clock.now()}ms`,
				};
			}
		}
	}

	async step(n: number): Promise<void> {
		for (let i = 0; i < n; i++) {
			if (!(await this.scheduler.step())) break;
			this.checkOpenRooms();
		}
	}

	async drain(): Promise<void> {
		try {
			// drain() throws on a livelock instead of hanging the suite.
			// A day of virtual time with only timers firing is a livelock...
			await this.scheduler.drain(100_000, 24 * 3_600_000);
			this.checkOpenRooms();
		} catch (e) {
			// ...unless every timer still running belongs to an offline device:
			// its heal retry keeps backing off until it reconnects (10 min cap,
			// sync.ts freeHealSlot), which is quiet enough to call settled.
			const offline = new Set([...this.offline].map((d) => this.devs[d].inc));
			const owners = this.clock.pendingOwners();
			if (owners.length > 0 && owners.every((o) => o && offline.has(o))) return;
			if (e instanceof Fail) throw e;
			this.fail("liveness/drain", e instanceof Error ? e.message.split("\n")[0] : String(e));
		}
	}

	// --- lookup ----------------------------------------------------------------

	note(n: number): LogicalNote {
		let note = this.notes.get(n);
		if (!note) {
			note = {
				created: false,
				deleted: false,
				id: null,
				slots: Object.fromEntries(SLOTS.map((s) => [s, "-"])),
				history: Object.fromEntries(SLOTS.map((s) => [s, new Set(["-"])])),
				conflict: false,
				rolledBack: false,
			};
			this.notes.set(n, note);
		}
		return note;
	}

	/** Every vault-relative file on a device's disk. */
	files(r: Replica): string[] {
		const out: string[] = [];
		const walk = (rel: string) => {
			const base = rel ? path.join(r.vaultDir, rel) : r.vaultDir;
			if (!fs.existsSync(base)) return;
			for (const e of fs.readdirSync(base, { withFileTypes: true })) {
				const child = rel ? `${rel}/${e.name}` : e.name;
				if (e.isDirectory()) walk(child);
				else if (!e.name.includes(".tmp-")) out.push(child);
			}
		};
		walk("");
		return out.sort();
	}

	read(r: Replica, p: string): string | null {
		const abs = path.join(r.vaultDir, p);
		return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
	}

	/** Where logical note `n` lives on a device (not a conflict copy). */
	pathOn(r: Replica, n: number): string | null {
		for (const p of this.files(r)) {
			if (!p.endsWith(".md") || isConflictCopy(p)) continue;
			if (noteNumber(this.read(r, p) ?? "") === n) return p;
		}
		return null;
	}

	/** The server's live note for logical note `n`. */
	serverNote(n: number): { id: string; path: string; content: string } | null {
		for (const [p, s] of this.server.state().notes) {
			if (!isConflictCopy(p) && noteNumber(s.content) === n)
				return { id: s.id, path: p, ...s };
		}
		return null;
	}

	allSettled(): boolean {
		return this.offline.size === 0 && this.suspended.size === 0;
	}

	/** Deliver everything in flight with no faults pending: what a delete
	 *  waits for, so it is never concurrent with an unsynced edit (that race
	 *  has no single right answer to check against). */
	async settle(): Promise<void> {
		this.server.clearDrops();
		for (const i of this.needsBlip) this.devs[i].dropNetwork();
		this.needsBlip.clear();
		await this.drain();
	}

	// --- ops -------------------------------------------------------------------

	async apply(op: Op): Promise<void> {
		const i = this.opIndex++;
		const r = this.devs[op.d];
		const letter = LETTERS[op.d];
		const note = this.note(op.n);
		const live = note.created && !note.deleted;
		const token = `${letter.toLowerCase()}${i}`;
		let did = "";
		switch (op.kind) {
			case "create": {
				if (note.created || this.suspended.has(op.d)) break;
				const folder = ["", "f0/", "f1/"][op.x % 3];
				await r.run(() => r.createNote(`${folder}t${op.n}.md`, skeleton(op.n)));
				note.created = true;
				did = `${folder}t${op.n}.md`;
				break;
			}
			case "edit":
			case "editOpen":
			case "conflict": {
				if (!live || this.suspended.has(op.d)) break;
				if (op.kind === "conflict") {
					if (op.d === op.d2 || this.suspended.has(op.d2)) break;
					if (!this.offline.has(op.d)) {
						r.run(() => r.goOffline());
						this.offline.add(op.d);
					}
					const a = await this.editSlot(r, op.n, "X", `${token}x`, false);
					const b = await this.editSlot(this.devs[op.d2], op.n, "X", `${token}y`, false);
					if (a || b) note.conflict = true;
					did = `${a ? "a" : "-"}${b ? "b" : "-"}`;
					break;
				}
				const ok = await this.editSlot(r, op.n, letter, token, op.kind === "editOpen");
				did = ok ? token : "held";
				break;
			}
			case "open":
			case "close": {
				const p = this.pathOn(r, op.n);
				if (!p || this.suspended.has(op.d)) break;
				await r.run(() => (op.kind === "open" ? r.openNote(p) : r.closeNote(p)));
				did = p;
				break;
			}
			case "remoteEdit": {
				const s = live ? this.serverNote(op.n) : null;
				if (!s) break;
				this.server.serverEditNote(s.id, (b) => setSlot(b, "S", `s${i}`) ?? b);
				this.expect(note, "S", `s${i}`);
				did = `s${i}`;
				break;
			}
			case "rename": {
				const p = live && !this.suspended.has(op.d) ? this.pathOn(r, op.n) : null;
				if (!p) break;
				const dir = op.x % 2 === 0 ? path.posix.dirname(p) : ["f0", "f1", "g"][op.x % 3];
				const to = `${dir === "." ? "" : `${dir}/`}t${op.n}-${i}.md`;
				await r.run(() => r.renameNote(p, to));
				did = `${p} -> ${to}`;
				break;
			}
			case "folderRename": {
				if (this.suspended.has(op.d)) break;
				const dirs = [
					...new Set(
						this.files(r)
							.filter((p) => p.includes("/") && p.endsWith(".md"))
							.map((p) => p.split("/")[0]),
					),
				];
				if (dirs.length === 0) break;
				const from = dirs[op.x % dirs.length];
				const to = `${from.split("_")[0]}_${i}`;
				await r.run(() => r.renameFolder(from, to));
				did = `${from} -> ${to}`;
				break;
			}
			case "delete":
			case "serverDelete": {
				if (!live || !this.allSettled()) break;
				await this.settle();
				const s = this.serverNote(op.n);
				if (op.kind === "serverDelete") {
					if (!s) break;
					this.server.serverDeleteNote(s.id);
				} else {
					const p = this.pathOn(r, op.n);
					if (!p) break;
					await r.run(() => r.deleteNote(p));
				}
				note.id = s?.id ?? note.id;
				note.deleted = true;
				did = s?.id ?? "?";
				break;
			}
			case "restore": {
				if (!note.deleted || !note.id) break;
				const tomb = this.server.noteIds().find((x) => x.id === note.id);
				if (!tomb?.deleted || this.server.noteIdAt(tomb.path)) break;
				this.server.serverRestoreNote(note.id);
				note.deleted = false;
				const s = this.serverNote(op.n);
				const slots = s ? parseBody(op.n, s.content) : null;
				if (slots) for (const [k, v] of Object.entries(slots)) this.expect(note, k, v);
				did = note.id;
				break;
			}
			case "offline":
				if (this.offline.has(op.d) || this.suspended.has(op.d)) break;
				r.run(() => r.goOffline());
				this.offline.add(op.d);
				did = "ok";
				break;
			case "online":
				if (!this.offline.has(op.d) || this.suspended.has(op.d)) break;
				await r.run(() => r.goOnline());
				this.offline.delete(op.d);
				did = "ok";
				break;
			case "blip":
				if (this.offline.has(op.d) || this.suspended.has(op.d)) break;
				r.dropNetwork();
				this.needsBlip.delete(op.d);
				did = "ok";
				break;
			case "suspend":
				if (this.suspended.has(op.d)) break;
				r.suspend();
				this.suspended.add(op.d);
				did = "ok";
				break;
			case "resume":
				if (!this.suspended.has(op.d)) break;
				r.resume();
				this.suspended.delete(op.d);
				did = "ok";
				break;
			case "restart":
			case "crash": {
				if (this.suspended.has(op.d)) break;
				// restart: force-quit at rest (what is in memory is dropped).
				// crash: killed mid-flight, typically inside a persist debounce.
				if (op.kind === "restart") await this.drain();
				await this.reboot(op.d);
				did = "ok";
				break;
			}
			case "lostReply":
				this.server.dropNextReply(r.id);
				did = "ok";
				break;
			case "dupFrame":
				this.server.duplicateNext(r.id);
				did = "ok";
				break;
			case "reorder":
				this.server.delayNext(r.id);
				did = "ok";
				break;
			case "lostRequest":
				this.server.dropNextInbound(r.id);
				did = "ok";
				break;
			case "lostFrame":
				// A frame lost on a live socket only happens when that socket dies.
				this.server.dropNext(r.id);
				this.needsBlip.add(op.d);
				did = "ok";
				break;
			case "snapshot": {
				const s = live ? this.serverNote(op.n) : null;
				const snap = s ? this.server.snapshotNote(s.id) : null;
				if (!snap) break;
				this.snaps.set(op.n, snap);
				did = "ok";
				break;
			}
			case "rollback": {
				const snap = this.snaps.get(op.n);
				const s = live && snap ? this.serverNote(op.n) : null;
				if (!s || !snap) break;
				this.server.rollback(s.id, snap);
				note.rolledBack = true;
				did = "ok";
				break;
			}
			case "bulkCreate": {
				if (this.note(100).created || this.suspended.has(op.d)) break;
				for (let k = 0; k < BULK_NOTES; k++) {
					await r.run(() => r.createNote(`bulk/t${100 + k}.md`, skeleton(100 + k)));
					this.note(100 + k).created = true;
				}
				did = `${BULK_NOTES} notes`;
				break;
			}
			case "bulkRemoteEdit": {
				// An MCP agent touching every note: each device's idle copies diverge.
				let count = 0;
				for (const [k, nt] of this.notes) {
					const s = nt.created && !nt.deleted ? this.serverNote(k) : null;
					if (!s) continue;
					this.server.serverEditNote(s.id, (b) => setSlot(b, "S", `s${i}`) ?? b);
					this.expect(nt, "S", `s${i}`);
					count++;
				}
				did = `${count} notes`;
				break;
			}
			case "attachAdd": {
				if (this.attachments.has(op.n) || this.suspended.has(op.d)) break;
				const p = `att/a${op.n}.png`;
				const bytes = new Uint8Array([
					0x89,
					0x50,
					0x4e,
					0x47,
					op.n,
					op.x & 0xff,
					op.x >> 8,
				]);
				await r.run(() => r.createAttachment(p, bytes));
				this.attachments.set(op.n, { path: p, deleted: false });
				did = p;
				break;
			}
			case "attachDelete":
			case "attachServerDelete": {
				const a = this.attachments.get(op.n);
				if (!a || a.deleted || !this.allSettled()) break;
				await this.settle();
				if (op.kind === "attachServerDelete") this.server.serverDeleteAttachment(a.path);
				else if (fs.existsSync(path.join(r.vaultDir, a.path))) {
					await r.run(() => r.deleteFile(a.path));
				} else break;
				a.deleted = true;
				did = "ok";
				break;
			}
		}
		this.trace.push(`${i}: ${fmtOp(op)}${did ? ` = ${did}` : " (skipped)"}`);
		await this.step(op.steps);
	}

	expect(note: LogicalNote, slot: string, value: string): void {
		note.slots[slot] = value;
		note.history[slot].add(value);
	}

	private async editSlot(
		r: Replica,
		n: number,
		slot: string,
		value: string,
		open: boolean,
	): Promise<boolean> {
		const p = this.pathOn(r, n);
		if (!p) return false;
		if (open && !r.isOpen(p)) await r.run(() => r.openNote(p));
		// Edit the text the user sees (the doc's, for an open note).
		const ok = await r.run(() => r.editNote(p, (cur) => setSlot(cur, slot, value)));
		if (ok) this.expect(this.note(n), slot, value);
		return ok;
	}

	/** Kill device `d`'s process and boot the next one on the same vault,
	 *  IndexedDB and data.json, with the same notes open (Obsidian restores
	 *  the workspace). */
	async reboot(d: number): Promise<void> {
		const old = this.devs[d];
		const open = old.openPaths();
		old.kill();
		const next = await Replica.boot({
			id: old.id,
			server: this.server,
			scheduler: this.scheduler,
			clock: this.clock,
			rootDir: this.rootDir,
			persisted: old.persisted,
			restart: true,
			incarnation: old.inc.n + 1,
		});
		this.devs[d] = next;
		this.offline.delete(d);
		this.needsBlip.delete(d);
		for (const p of open) {
			if (fs.existsSync(path.join(next.vaultDir, p))) await next.run(() => next.openNote(p));
		}
	}

	// --- quiescence + invariants ----------------------------------------------

	async quiesce(): Promise<void> {
		for (const d of [...this.suspended]) this.devs[d].resume();
		this.suspended.clear();
		for (const d of [...this.offline]) await this.devs[d].run(() => this.devs[d].goOnline());
		this.offline.clear();
		await this.settle();
		await this.drain();
	}

	check(): void {
		const { notes } = this.server.state();
		// structure + duplicate + lost-edit + delete, per logical note
		for (const [n, note] of this.notes) {
			if (!note.created) continue;
			const copies = [...notes].filter(([, s]) => noteNumber(s.content) === n);
			const primary = copies.filter(([p]) => !isConflictCopy(p));
			const conflicts = copies.filter(([p]) => isConflictCopy(p));
			if (conflicts.length > 0 && !note.conflict) {
				this.fail(
					"duplicate/conflict-copy",
					`t${n} has conflict copies ${conflicts.map(([p]) => p).join(", ")} with no injected conflict`,
				);
			}
			if (note.deleted) {
				if (primary.length > 0) {
					this.fail(
						"delete/resurrected",
						`t${n} was deleted and not restored, but the server holds it at ${primary.map(([p]) => p).join(", ")}`,
					);
				}
				continue;
			}
			if (primary.length !== 1) {
				this.fail(
					primary.length === 0 ? "lost-note" : "duplicate/note",
					`t${n}: ${primary.length} live copies on the server (${primary.map(([p]) => p).join(", ") || "none"})`,
				);
			}
			const [p, s] = primary[0];
			const slots = parseBody(n, s.content);
			if (!slots) {
				this.fail(
					"structure",
					`t${n} at ${p} lost its skeleton: ${JSON.stringify(s.content)}`,
				);
			}
			for (const slot of SLOTS) {
				if (slot === "X" && note.conflict) continue;
				const want = note.slots[slot];
				const got = slots[slot];
				if (got === want) continue;
				if (note.rolledBack && note.history[slot].has(got)) continue;
				// A real conflict resolves as ONE conflict copy of the local text
				// (crdt-load-gate.md): that device's edits live on in the copy.
				if (
					note.conflict &&
					conflicts.some(([, c]) => parseBody(n, c.content)?.[slot] === want)
				) {
					continue;
				}
				this.fail(
					"lost-edit",
					`t${n} slot ${slot} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)} (server ${p})`,
				);
			}
		}
		// Every server note belongs to a logical note (conflict copies included).
		for (const [p, s] of notes) {
			const n = noteNumber(s.content);
			if (n === null || !this.notes.get(n)?.created) {
				this.fail(
					"structure",
					`server note ${p} is no known note: ${JSON.stringify(s.content)}`,
				);
			}
		}
		// converge: every device's disk equals the server, file for file.
		const liveAttachments = new Set(this.server.attachmentPaths());
		for (const [, a] of this.attachments) {
			if (a.deleted && liveAttachments.has(a.path)) {
				this.fail(
					"delete/attachment",
					`${a.path} was deleted but the server still holds it`,
				);
			}
		}
		const want = new Set([...notes.keys(), ...liveAttachments]);
		for (const r of this.devs) {
			const have = this.files(r);
			for (const p of have) {
				if (!want.has(p)) {
					this.fail(
						"converge",
						`${r.id} holds ${p} the server does not (${JSON.stringify(this.read(r, p)?.slice(0, 80))})`,
					);
				}
			}
			for (const p of want) {
				if (!have.includes(p)) this.fail("converge", `${r.id} is missing ${p}`);
				const s = notes.get(p);
				if (s && this.read(r, p) !== s.content) {
					this.fail(
						"converge",
						`${r.id}:${p} disk ${JSON.stringify(this.read(r, p))} != server ${JSON.stringify(s.content)}`,
					);
				}
			}
		}
		this.checkHealLiveness();
	}

	/** Every device's resident docs equal the server, read only after the
	 *  disk checks (opening a doc can start a handshake). */
	async checkDocs(): Promise<void> {
		const { notes } = this.server.state();
		const reads: { r: Replica; p: string; want: string; text: Promise<string> }[] = [];
		for (const r of this.devs) {
			for (const [p, s] of notes) {
				const id = r.noteIdMap.get(p);
				if (!id || id !== s.id || !r.crdtManager.hasDoc(id)) continue;
				reads.push({ r, p, want: s.content, text: r.crdtManager.projectedText(id) });
			}
		}
		let done = false;
		void Promise.allSettled(reads.map((x) => x.text)).then(() => {
			done = true;
		});
		for (let k = 0; k < 20 && !done; k++) await this.scheduler.drain();
		for (const x of reads) {
			const text = await x.text.catch((e) => `<error ${e}>`);
			if (text !== "" && text !== x.want) {
				this.fail(
					"doc",
					`${x.r.id}:${x.p} Y.Doc ${JSON.stringify(text)} != server ${JSON.stringify(x.want)}`,
				);
			}
		}
	}

	private checkHealLiveness(): void {
		for (const r of this.devs) {
			const e = r.engine as unknown as Record<string, { size?: number } | undefined>;
			const stuck = ["idleHealWaiting", "idleHealSlots", "healRetryTimers"]
				.map((f) => [f, e[f]?.size ?? 0] as const)
				.filter(([, size]) => size > 0);
			if (stuck.length > 0) {
				this.fail(
					"liveness/heal",
					`${r.id} still marked for heal after quiescence: ${stuck.map(([f, n]) => `${f}=${n}`).join(" ")}`,
				);
			}
		}
	}

	cleanup(): void {
		for (const r of this.devs) r.kill();
		fs.rmSync(this.rootDir, { recursive: true, force: true });
	}
}

// --- runner ------------------------------------------------------------------

export interface RunResult {
	violation: Violation | null;
	trace: string[];
}

export async function runOps(seed: number, nDev: number, ops: Op[]): Promise<RunResult> {
	const w = new World(seed);
	try {
		await w.boot(nDev);
		for (const op of ops) {
			await w.apply(op);
			if (w.violation) throw new Fail(w.violation);
		}
		await w.quiesce();
		if (w.violation) throw new Fail(w.violation);
		w.check();
		await w.checkDocs();
		return { violation: w.violation, trace: w.trace };
	} catch (e) {
		const v =
			e instanceof Fail
				? e.v
				: {
						invariant: "crash",
						detail: e instanceof Error ? (e.stack ?? e.message) : String(e),
					};
		return { violation: v, trace: w.trace };
	} finally {
		w.cleanup();
	}
}

/** Drop ops while the run still fails the same invariant (ddmin, bounded). */
export async function shrink(
	seed: number,
	nDev: number,
	ops: Op[],
	invariant: string,
): Promise<Op[]> {
	let cur = ops;
	let chunk = Math.max(1, Math.floor(cur.length / 2));
	let budget = Number(process.env.SIM_SHRINK_RUNS ?? 150);
	while (chunk >= 1 && budget > 0) {
		let removed = false;
		for (let at = 0; at < cur.length && budget > 0; at += chunk) {
			const cand = [...cur.slice(0, at), ...cur.slice(at + chunk)];
			budget--;
			const res = await runOps(seed, nDev, cand);
			if (res.violation?.invariant === invariant) {
				cur = cand;
				removed = true;
				at -= chunk;
			}
		}
		if (!removed) chunk = Math.floor(chunk / 2);
	}
	return cur;
}

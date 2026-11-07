/**
 * Folder identity and the outbound folder-op protocol (Engram#2523 S4).
 *
 * One Obsidian folder rename or move becomes ONE `folder_op` on the wire
 * instead of one operation per descendant. The server addresses folders by id
 * (`folders` rows, R9), so this module keeps:
 *
 *  - `FolderIndex`: folder id <-> path, learned from the manifest's `folders`
 *    list and from `folder_changed` events. Root is `null` on the wire and
 *    never has a row.
 *  - the PENDING queue: folder ops the server has not answered yet, keyed by
 *    folder id, persisted with the plugin data so a crash replays them.
 *  - the HELD inbound changes: server state for a folder that has a pending
 *    local op, which would otherwise undo the local move before the server
 *    has seen it.
 *
 * Both of the last two are hiding layers (docs/context/
 * crdt-sync-store-hiding-layers.md), so each names what clears it:
 *
 * | layer          | clearing events                                         |
 * |----------------|---------------------------------------------------------|
 * | pending op     | ack: clear. Refusal or `unknown_event`: clear, then the |
 * |                | per-file fallback. Feature off: per-file fallback.      |
 * |                | Timeout: stays, re-sent with the same `op_id`. Crash:   |
 * |                | replayed from disk. Vault switch: dropped (`reset`).    |
 * | held inbound   | ack (changes newer than the ack's seq apply), refusal   |
 * |                | (newest applies), socket reconnect (dropped; the        |
 * |                | reconnect's manifest is the truth), max age             |
 * |                | `HOLD_MAX_MS` (newest applies).                         |
 *
 * If a clearing event never fires: a pending op is re-sent on every flush
 * (it never hides anything but the server's ignorance of a local move), and a
 * held change expires after `HOLD_MAX_MS`, so no folder can go deaf.
 *
 * The same-tick rename batch and the Relay echo rule live in the sync engine:
 * the batch is cleared at the end of its tick, and the echo rule is a state
 * check, not a layer.
 */
import { uuid7 } from "./crdt/uuid7";

/** One `folders` row as the server sends it. `parent_id: null` = root. */
export type FolderRow = { id: string; parent_id: string | null; name: string };

/** A `folder_changed` event or a feed `folders` entry. */
export type FolderChange = FolderRow & {
	seq?: number | null;
	deleted?: boolean;
	device_id?: string | null;
};

export type FolderOp = {
	op: "move" | "create";
	/** For tracing only: the target is absolute, so a replay is idempotent. */
	op_id: string;
	folder_id: string;
	parent_id: string | null;
	name: string;
	/** The folder's path BEFORE this op, as the server last knew it. The per-file
	 *  fallback rebuilds each child's old path from it. Null for a create. */
	from: string | null;
	/** The vault the op was made in. Another vault's op is never sent. */
	vaultId: string | null;
};

/** What the server did with one op. `retry`: no answer (timeout, socket down,
 *  rate limited); the op stays queued. */
export type FolderOpResult =
	| { kind: "ok"; seq: number | null }
	| { kind: "refused"; reason: string }
	| { kind: "unknown_event" }
	| { kind: "retry" };

/** How long a held inbound change waits for the local op's answer. */
export const HOLD_MAX_MS = 3 * 60 * 1000;

/** Depth cap on a parent-chain walk, so corrupt rows cannot loop it. */
const MAX_DEPTH = 256;

export class FolderIndex {
	private readonly rows = new Map<string, FolderRow>();
	private byPath: Map<string, string> | null = null;

	/** Replace every row with the server's list, except ids `keep` vouches
	 *  for (a pending local op is newer than any manifest). */
	load(rows: FolderRow[], keep: (id: string) => boolean = () => false): void {
		const kept = [...this.rows.values()].filter((r) => keep(r.id));
		this.rows.clear();
		for (const r of rows)
			this.rows.set(r.id, { id: r.id, parent_id: r.parent_id, name: r.name });
		for (const r of kept) this.rows.set(r.id, r);
		this.byPath = null;
	}

	set(row: FolderRow): void {
		this.rows.set(row.id, { id: row.id, parent_id: row.parent_id, name: row.name });
		this.byPath = null;
	}

	remove(id: string): void {
		if (this.rows.delete(id)) this.byPath = null;
	}

	has(id: string): boolean {
		return this.rows.has(id);
	}

	size(): number {
		return this.rows.size;
	}

	/** Derived path of folder `id` (`null` = root = ""), or null when the chain
	 *  is broken or loops. */
	pathFor(id: string | null): string | null {
		if (id === null) return "";
		const parts: string[] = [];
		let at: string | null = id;
		for (let depth = 0; at !== null; depth++) {
			const row = this.rows.get(at);
			if (!row || depth >= MAX_DEPTH) return null;
			parts.unshift(row.name);
			at = row.parent_id;
		}
		return parts.join("/");
	}

	/** Folder id at `path`: `null` for the root (""), `undefined` if unknown. */
	idFor(path: string): string | null | undefined {
		if (path === "" || path === "/") return null;
		if (!this.byPath) {
			this.byPath = new Map();
			for (const id of this.rows.keys()) {
				const p = this.pathFor(id);
				if (p !== null) this.byPath.set(p, id);
			}
		}
		return this.byPath.get(path);
	}
}

export type FolderOpsDeps = {
	send: (op: FolderOp) => Promise<FolderOpResult>;
	now: () => number;
	/** The vault being synced right now. */
	vaultId: () => string | null;
	/** Redo a refused or unsendable op per file (today's path). */
	fallback: (op: FolderOp, why: string) => Promise<void>;
	/** The server applied `op` (its local self-heal hook). */
	acked: (op: FolderOp, seq: number | null) => Promise<void>;
	/** Apply an inbound folder change to the vault now. */
	apply: (change: FolderChange) => Promise<void>;
	/** The pending queue changed: persist it. */
	persist: () => void;
};

export class FolderOps {
	readonly index = new FolderIndex();
	/** Pending ops, keyed by folder id, in send order. */
	private readonly queue = new Map<string, FolderOp>();
	/** Inbound changes held behind a pending local op, by folder id. */
	private readonly held = new Map<string, { changes: FolderChange[]; since: number }>();
	/** `features.folder_ops` from the last join reply. */
	private feature = false;
	/** The server said `unknown_event`: off until the next session. */
	private refusedForSession = false;
	private flushing: Promise<void> | null = null;

	constructor(private readonly deps: FolderOpsDeps) {}

	enabled(): boolean {
		return this.feature && !this.refusedForSession;
	}

	/** The join reply's `features.folder_ops`. Off with ops still queued means
	 *  the server we reconnected to cannot take them: redo them per file. */
	async setFeature(on: boolean): Promise<void> {
		this.feature = on;
		if (!this.enabled()) await this.fallbackAll("feature_off");
	}

	hasPending(folderId: string): boolean {
		return this.queue.has(folderId);
	}

	/** Pending ops, in send order (persistence). */
	all(): FolderOp[] {
		return [...this.queue.values()];
	}

	/** Restore ops persisted by an earlier session. */
	load(ops: FolderOp[]): void {
		for (const op of ops) this.queue.set(op.folder_id, op);
	}

	/** Vault switch or sign-out: nothing here addresses the new vault. */
	reset(): void {
		this.queue.clear();
		this.held.clear();
		this.index.load([]);
		this.refusedForSession = false;
		this.deps.persist();
	}

	/** Queue a move of a server-known folder to `parentId`/`name`. `from` is the
	 *  path the server knows it at. The index moves now: local state is true. */
	move(folderId: string, parentId: string | null, name: string, from: string): void {
		this.enqueue({
			op: "move",
			op_id: uuid7(),
			folder_id: folderId,
			parent_id: parentId,
			name,
			from,
			vaultId: this.deps.vaultId(),
		});
		this.index.set({ id: folderId, parent_id: parentId, name });
	}

	/** Mint an id for a folder the server has never seen and queue its create. */
	create(parentId: string | null, name: string): string {
		const folderId = uuid7();
		this.index.set({ id: folderId, parent_id: parentId, name });
		this.enqueue({
			op: "create",
			op_id: uuid7(),
			folder_id: folderId,
			parent_id: parentId,
			name,
			from: null,
			vaultId: this.deps.vaultId(),
		});
		return folderId;
	}

	/** Id for the folder at `path`, queueing creates for it and any missing
	 *  ancestor. `null` = root. */
	ensure(path: string): string | null {
		const known = this.index.idFor(path);
		if (known !== undefined) return known;
		const cut = path.lastIndexOf("/");
		const parentId = this.ensure(cut < 0 ? "" : path.slice(0, cut));
		return this.create(parentId, cut < 0 ? path : path.slice(cut + 1));
	}

	/** Coalesce per folder: a create absorbs a later move (the server never saw
	 *  it, so create it at the final place); a later move replaces an earlier one
	 *  but keeps the earliest `from`, which is what the server still holds. */
	private enqueue(op: FolderOp): void {
		const prev = this.queue.get(op.folder_id);
		if (prev?.op === "create") {
			this.queue.set(op.folder_id, { ...prev, parent_id: op.parent_id, name: op.name });
		} else {
			if (prev) this.queue.delete(op.folder_id);
			this.queue.set(op.folder_id, prev ? { ...op, from: prev.from } : op);
		}
		this.deps.persist();
	}

	/** Send every pending op, in order. Single-flight. */
	flush(): Promise<void> {
		this.flushing ??= this.runFlush().finally(() => {
			this.flushing = null;
		});
		return this.flushing;
	}

	private async runFlush(): Promise<void> {
		if (!this.enabled()) return;
		for (const op of [...this.queue.values()]) {
			if (this.queue.get(op.folder_id) !== op) continue; // answered via a dependency
			if (!(await this.sendOne(op, new Set()))) return; // no answer: retry later
		}
	}

	/** Send `op`, after any pending create its parent depends on. False = the
	 *  server gave no answer, so stop until the next flush. */
	private async sendOne(op: FolderOp, seen: Set<string>): Promise<boolean> {
		seen.add(op.folder_id);
		const parent = op.parent_id === null ? undefined : this.queue.get(op.parent_id);
		if (parent?.op === "create" && !seen.has(parent.folder_id)) {
			if (!(await this.sendOne(parent, seen))) return false;
		}
		if (this.queue.get(op.folder_id) !== op) return true;
		if (op.vaultId !== null && op.vaultId !== this.deps.vaultId()) {
			this.queue.delete(op.folder_id);
			this.deps.persist();
			return true;
		}
		const res = await this.deps.send(op);
		if (res.kind === "retry") return false;
		// Superseded while in flight: the newer op is still queued and owns the
		// folder. Its own send settles it.
		if (this.queue.get(op.folder_id) !== op) return true;
		if (res.kind === "unknown_event") {
			this.refusedForSession = true;
			await this.fallbackAll("unknown_event");
			return false;
		}
		this.queue.delete(op.folder_id);
		this.deps.persist();
		if (res.kind === "ok") {
			await this.deps.acked(op, res.seq);
			await this.release(op.folder_id, res.seq);
		} else {
			await this.release(op.folder_id, null);
			await this.deps.fallback(op, res.reason);
		}
		return true;
	}

	/** Every queued op goes per file. */
	private async fallbackAll(why: string): Promise<void> {
		for (const op of [...this.queue.values()]) {
			this.queue.delete(op.folder_id);
			this.deps.persist();
			await this.release(op.folder_id, null);
			if (op.vaultId === null || op.vaultId === this.deps.vaultId()) {
				await this.deps.fallback(op, why);
			}
		}
	}

	/** An inbound folder change. Held while this device has a pending op for
	 *  the same folder, applied otherwise. */
	async inbound(change: FolderChange): Promise<void> {
		if (this.queue.has(change.id)) {
			const h = this.held.get(change.id);
			if (h) h.changes.push(change);
			else this.held.set(change.id, { changes: [change], since: this.deps.now() });
			return;
		}
		await this.deps.apply(change);
	}

	/** Clear a hold. `afterSeq` (an ack): only changes the server made AFTER our
	 *  op still matter. `null` (a refusal or expiry): the newest one is the truth. */
	private async release(folderId: string, afterSeq: number | null): Promise<void> {
		const h = this.held.get(folderId);
		if (!h) return;
		this.held.delete(folderId);
		const newest = h.changes
			.filter((c) => afterSeq === null || (c.seq ?? 0) > afterSeq)
			.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
			.pop();
		if (newest) await this.deps.apply(newest);
	}

	/** Socket reconnect: pending ops are re-sent, and the reconnect's manifest
	 *  re-teaches the server's folder state, so no held change is kept. */
	async onReconnect(): Promise<void> {
		this.held.clear();
		await this.flush();
	}

	/** Periodic: expire holds past `HOLD_MAX_MS` and retry unanswered ops. */
	async tick(): Promise<void> {
		const now = this.deps.now();
		for (const [id, h] of [...this.held]) {
			if (now - h.since > HOLD_MAX_MS) await this.release(id, null);
		}
		await this.flush();
	}
}

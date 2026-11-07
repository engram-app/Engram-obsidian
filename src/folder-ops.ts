/**
 * Folder identity and the outbound folder-op protocol (Engram#2523 S4).
 *
 * One Obsidian folder rename or move becomes ONE `folder_op move` on the wire
 * instead of one operation per descendant. The server addresses folders by id
 * (`folders` rows, R9), so this module keeps:
 *
 *  - `FolderIndex`: folder id <-> path, learned from the manifest's `folders`
 *    list, `folder_changed` events and the `crdt_create` reply. Root is `null`
 *    on the wire and never has a row. Persisted with the plugin data, so a
 *    restarted device still knows where its folders were before the next
 *    manifest arrives.
 *  - the PENDING queue: moves the server has not answered yet, keyed by folder
 *    id, persisted so a crash replays them. Each op carries both paths (`from`,
 *    where the server has the folder; `to`, where the user put it), so its
 *    per-file fallback never depends on in-memory state.
 *  - the HELD inbound changes: server state for a folder that has a pending
 *    local op, which would otherwise undo the local move before the server
 *    has seen it.
 *
 * Only a folder AND a target parent that both have server ids are ever sent:
 * a `folder_op` naming an id the server never issued cannot succeed, so such a
 * rename goes per file from the start. (The plan's client-minted `create` is
 * not sent for the same reason: its target has no server id by definition.)
 *
 * Both of the last two layers hide state (docs/context/
 * crdt-sync-store-hiding-layers.md), so each names what clears it:
 *
 * | layer          | clearing events                                         |
 * |----------------|---------------------------------------------------------|
 * | pending op     | ack: clear. Refusal or `unknown_event`: clear, then the |
 * |                | per-file fallback. Feature off: per-file fallback.      |
 * |                | Timeout: stays, re-sent with the same `op_id`. Crash:   |
 * |                | replayed from disk. Vault switch: dropped. NEVER by a   |
 * |                | hold expiry: only the server's answer or a fallback.    |
 * | held inbound   | ack (changes newer than the ack's seq apply), refusal   |
 * |                | (newest applies), socket reconnect (dropped; the        |
 * |                | reconnect's manifest is the truth), max age             |
 * |                | `HOLD_MAX_MS` (newest applies; the op stays queued and  |
 * |                | its ack moves the disk back to the server's state).     |
 *
 * If a clearing event never fires: a pending op is re-sent on every flush
 * (it hides nothing but the server's ignorance of a local move), and a held
 * change expires after `HOLD_MAX_MS`, so no folder can go deaf.
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
	op: "move";
	/** For tracing only: the target is absolute, so a replay is idempotent. */
	op_id: string;
	folder_id: string;
	parent_id: string | null;
	name: string;
	/** The folder's path as the server knows it (before the op). */
	from: string;
	/** Where the user put it: the local path the per-file fallback walks. */
	to: string;
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

	all(): FolderRow[] {
		return [...this.rows.values()];
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

	/** The server says the folder at `path` has id `id` (a `crdt_create` reply):
	 *  learn it when its parent is known, so a folder synced this session can be
	 *  moved by id without waiting for the next manifest. */
	learn(path: string, id: string): void {
		if (this.idFor(path) === id) return;
		const cut = path.lastIndexOf("/");
		const parent = this.idFor(cut < 0 ? "" : path.slice(0, cut));
		if (parent === undefined) return;
		this.set({ id, parent_id: parent, name: cut < 0 ? path : path.slice(cut + 1) });
	}
}

export type FolderOpsDeps = {
	send: (op: FolderOp) => Promise<FolderOpResult>;
	now: () => number;
	/** The vault being synced right now. */
	vaultId: () => string | null;
	/** Redo a refused or unsendable op per file (today's path). */
	fallback: (op: FolderOp, why: string) => Promise<void>;
	/** The server applied `op`: make sure the disk is where the server is. */
	acked: (op: FolderOp, seq: number | null) => Promise<void>;
	/** Apply an inbound folder change to the vault now. */
	apply: (change: FolderChange) => Promise<void>;
	/** The queue or the index changed: persist them. */
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

	/** Restore ops persisted by an earlier session (ops without a target path
	 *  predate this format and cannot fall back, so they are not restored). */
	load(ops: FolderOp[]): void {
		for (const op of ops) if (typeof op.to === "string") this.queue.set(op.folder_id, op);
	}

	/** Vault switch or sign-out: nothing here addresses the new vault. */
	reset(): void {
		this.queue.clear();
		this.held.clear();
		this.index.load([]);
		this.refusedForSession = false;
		this.deps.persist();
	}

	/** Queue a move of a server-known folder (now at `to` locally) under
	 *  `parentId`, both server ids. `from` is where the server has it. A later
	 *  move of the same folder replaces this one but keeps the earliest `from`.
	 *  The index moves now: local state is true. */
	move(folderId: string, parentId: string | null, name: string, from: string, to: string): void {
		const prev = this.queue.get(folderId);
		if (prev) this.queue.delete(folderId);
		this.queue.set(folderId, {
			op: "move",
			op_id: uuid7(),
			folder_id: folderId,
			parent_id: parentId,
			name,
			from: prev?.from ?? from,
			to,
			vaultId: this.deps.vaultId(),
		});
		this.index.set({ id: folderId, parent_id: parentId, name });
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
			if (this.queue.get(op.folder_id) !== op) continue;
			if (!(await this.sendOne(op))) return; // no answer: retry later
		}
	}

	/** Send `op`. False = the server gave no answer, so stop until the next
	 *  flush. */
	private async sendOne(op: FolderOp): Promise<boolean> {
		if (op.vaultId !== null && op.vaultId !== this.deps.vaultId()) {
			this.queue.delete(op.folder_id);
			this.deps.persist();
			return true;
		}
		const res = await this.deps.send(op);
		if (res.kind === "retry") return false;
		// Superseded (or dropped by a hold expiry) while in flight: whatever
		// replaced it owns the folder now.
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

	/** Periodic: expire holds past `HOLD_MAX_MS` and retry unanswered ops.
	 *
	 *  An expired hold applies the other writer's newest change, but OUR op
	 *  stays queued: only the server's answer (ack or refusal) or a fallback
	 *  to per file resolves it. Dropping it on expiry undid the user's own
	 *  move whenever the server was merely slow. If the op is then acked, the
	 *  server is at ours and the ack handler moves the disk there too (our own
	 *  `folder_changed` echo is dropped, so nothing else would). */
	async tick(): Promise<void> {
		const now = this.deps.now();
		for (const [id, h] of [...this.held]) {
			if (now - h.since > HOLD_MAX_MS) await this.release(id, null);
		}
		await this.flush();
	}
}

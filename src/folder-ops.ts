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
 * | pending op     | ack: clear. Refusal (`conflict`, `cycle`,               |
 * |                | `invalid_name`) or `unknown_event`: clear, then the     |
 * |                | per-file fallback. `not_found` / `failed`: retried in   |
 * |                | the budget below. Feature off: per-file fallback.       |
 * |                | No answer (timeout, lost frame, disconnect): re-sent    |
 * |                | with backoff, same `op_id`, until `MAX_ATTEMPTS` sends, |
 * |                | then the per-file fallback (final). `rate_limited`:     |
 * |                | the queue pauses, no attempt spent (the note-op queue's |
 * |                | RateLimitPause). Age: `OP_TTL_MS` from enqueue, sent or |
 * |                | not (a crdt topic that stays down, a features reply     |
 * |                | that never comes), then the per-file fallback, which    |
 * |                | today's REST/queue paths deliver. Not joined: no        |
 * |                | attempt spent. Crash: replayed from disk with its spent |
 * |                | budget. Vault switch: dropped. NEVER by a hold expiry.  |
 * |                | The delete-pass skip and held changes clear with it.    |
 * | held inbound   | ack (changes newer than the ack's seq apply), refusal   |
 * |                | (newest applies), socket reconnect (dropped; the        |
 * |                | reconnect's manifest is the truth), max age             |
 * |                | `HOLD_MAX_MS` (newest applies; the op stays queued and  |
 * |                | its ack moves the disk back to the server's state).     |
 *
 * If the server never answers, the attempt cap or the age cap ends the op in
 * the per-file fallback, so a pending op cannot hide anything forever; a held
 * change expires after `HOLD_MAX_MS`. No folder can go deaf.
 */
import { expBackoff } from "./backoff";
import { uuid7 } from "./crdt/uuid7";
// One source of truth for "how long may an unanswered socket op wait": the
// durable note-op queue's limits, not a sibling set.
import {
	BASE_BACKOFF_MS,
	MAX_ATTEMPTS,
	MAX_BACKOFF_MS,
	OP_TTL_MS,
	RateLimitPause,
} from "./crdt-op-queue";

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
	/** Sends that got no answer (persisted, so a crash loop is bounded too). */
	attempts?: number;
	/** When the op was queued; the age cap counts from here whether or not a
	 *  send ever went out (rate-limit pauses are credited back). */
	queuedAt?: number;
	/** Backoff: not re-sent before this. */
	nextAttemptAt?: number;
};

/** What the server did with one op. `retry`: sent but no answer (timeout,
 *  lost frame, disconnect, rate limited); spends an attempt. `held`: never
 *  sent (crdt topic not joined, no socket); spends nothing. */
export type FolderOpResult =
	| { kind: "ok"; seq: number | null }
	| { kind: "refused"; reason: string }
	| { kind: "unknown_event" }
	| { kind: "retry" }
	| { kind: "rate_limited" }
	| { kind: "held" };

/** Refusals that are retried inside the op's attempt budget instead of
 *  falling back at once. `not_found`: until S5 the server resolves ids to
 *  paths before its write transaction, so a move racing another move can
 *  miss (Engram#2533 `Folders.Wire.move`). `failed`: the server's own
 *  transient error. */
const RETRIED_REFUSALS: ReadonlySet<string> = new Set(["not_found", "failed"]);

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

	/** Learn server folder rows, the ONE rule for every source (manifest list,
	 *  `POST /folders` and `crdt_create` chains): malformed rows are dropped,
	 *  and a folder with OUR op pending keeps our row, since the server's is
	 *  from before that op. `chain`: a root-first ancestor chain, learned up
	 *  to its first broken parent link; otherwise the full list, which
	 *  replaces the index. */
	learnServerRows(rows: unknown, mode: "list" | "chain" | "rows"): void {
		if (!Array.isArray(rows)) return;
		const chain = mode === "chain";
		const valid: FolderRow[] = [];
		for (const r of rows) {
			if (!isFolderRow(r)) {
				if (chain) break;
				continue;
			}
			const prev = valid[valid.length - 1];
			if (chain && r.parent_id !== (prev ? prev.id : null)) break;
			valid.push(r);
		}
		if (mode === "list") this.index.load(valid, (id) => this.hasPending(id));
		else for (const r of valid) if (!this.hasPending(r.id)) this.index.set(r);
		this.deps.persist();
	}

	/** The server says the folder at `path` is `id` (the `crdt_create` reply's
	 *  leaf `folder_id`): one row through `learnServerRows`, learned when its
	 *  parent is known. */
	learnServerLeaf(path: string, id: string): void {
		const cut = path.lastIndexOf("/");
		const parent = this.index.idFor(cut < 0 ? "" : path.slice(0, cut));
		if (parent === undefined || this.index.idFor(path) === id) return;
		const name = cut < 0 ? path : path.slice(cut + 1);
		this.learnServerRows([{ id, parent_id: parent, name }], "rows");
	}

	/** Restore ops persisted by an earlier session (ops without a target path
	 *  predate this format and cannot fall back, so they are not restored). */
	load(ops: FolderOp[]): void {
		for (const op of ops) {
			if (typeof op.to !== "string") continue;
			this.queue.set(op.folder_id, { ...op, queuedAt: op.queuedAt ?? this.deps.now() });
		}
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
			queuedAt: prev?.queuedAt ?? this.deps.now(),
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
			if (this.rateLimit.paused()) return;
			this.creditRateLimitPause();
			if (this.queue.get(op.folder_id) !== op) continue;
			if ((op.nextAttemptAt ?? 0) > this.deps.now()) continue; // backing off
			if (!(await this.sendOne(op))) return; // socket down: stop until next flush
		}
	}

	/** Send `op`. False = not sent (socket down), so stop until the next
	 *  flush. */
	private async sendOne(op: FolderOp): Promise<boolean> {
		if (op.vaultId !== null && op.vaultId !== this.deps.vaultId()) {
			this.queue.delete(op.folder_id);
			this.deps.persist();
			return true;
		}
		const res = await this.deps.send(op);
		if (res.kind === "held") return false;
		if (res.kind === "rate_limited") {
			// Not the op's fault: pause the whole queue, spend nothing.
			if (this.queue.get(op.folder_id) === op) op.nextAttemptAt = this.rateLimit.hit();
			this.deps.persist();
			return false;
		}
		if (res.kind === "retry" || (res.kind === "refused" && RETRIED_REFUSALS.has(res.reason))) {
			if (this.queue.get(op.folder_id) !== op) return true;
			op.attempts = (op.attempts ?? 0) + 1;
			op.nextAttemptAt =
				this.deps.now() + expBackoff(BASE_BACKOFF_MS, op.attempts - 1, MAX_BACKOFF_MS);
			this.deps.persist();
			if (op.attempts >= MAX_ATTEMPTS) {
				// The last refusal names the fallback when there was one.
				await this.giveUp(op, res.kind === "refused" ? res.reason : "max-attempts");
			}
			return true;
		}
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
			this.rateLimit.delivered();
			await this.deps.acked(op, res.seq);
			await this.release(op.folder_id, res.seq);
		} else {
			await this.release(op.folder_id, null);
			await this.deps.fallback(op, res.reason);
		}
		return true;
	}

	/** The server never answered: end the op in the per-file fallback (its
	 *  final clearing event), which also clears its hold and delete-pass skip. */
	private async giveUp(op: FolderOp, why: string): Promise<void> {
		this.queue.delete(op.folder_id);
		this.deps.persist();
		await this.release(op.folder_id, null);
		await this.deps.fallback(op, why);
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
		if (!isFolderRow(change)) return; // the one row rule, as learnServerRows
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
		// Due at once on a fresh socket, as the note-op queue's onJoined does;
		// the spent attempts and the age stand.
		for (const op of this.queue.values()) op.nextAttemptAt = 0;
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
		// The age cap runs whether or not anything could be sent: an op held for
		// a crdt topic that stays down, or restored with no features reply, ends
		// in the per-file fallback too, so its delete-pass skip always clears.
		if (!this.rateLimit.paused()) this.creditRateLimitPause();
		for (const op of [...this.queue.values()]) {
			if (now - (op.queuedAt ?? now) > OP_TTL_MS && this.queue.get(op.folder_id) === op) {
				await this.giveUp(op, "ttl");
			}
		}
		await this.flush();
	}

	/** The note-op queue's pause, shared code: see `RateLimitPause`. */
	private readonly rateLimit = new RateLimitPause(
		() => this.deps.now(),
		(n) => expBackoff(BASE_BACKOFF_MS, n - 1, MAX_BACKOFF_MS),
	);

	/** A pause that ended is held time, not age: credit it back (the queue's rule). */
	private creditRateLimitPause(): void {
		const pause = this.rateLimit.takeEnded();
		if (!pause) return;
		for (const op of this.queue.values()) {
			const heldFor = pause.until - Math.max(pause.from, op.queuedAt ?? pause.from);
			if (heldFor > 0 && op.queuedAt !== undefined) op.queuedAt += heldFor;
		}
		this.deps.persist();
	}
}

/** The one shape check for a server folder row (manifest, chains,
 *  `folder_changed`, manifest moves). */
export function isFolderRow(r: unknown): r is FolderRow {
	if (typeof r !== "object" || r === null) return false;
	const row = r as Record<string, unknown>;
	return (
		typeof row.id === "string" &&
		row.id.length > 0 &&
		typeof row.name === "string" &&
		row.name.length > 0 &&
		!row.name.includes("/") &&
		(row.parent_id === null || typeof row.parent_id === "string")
	);
}

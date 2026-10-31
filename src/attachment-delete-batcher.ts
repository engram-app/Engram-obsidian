/**
 * Serializes attachment deletes, coalescing them into
 * `POST /attachments/batch-delete` when the server supports it.
 *
 * A folder delete fires one vault event per file, and each used to become its
 * own `DELETE /attachments/<path>`, all in parallel: 407 in about a minute on
 * 2026-10-31, each taking the server's per-vault seq lock. Calls made within
 * WINDOW_MS are grouped per vault into chunks of CHUNK paths, and exactly one
 * request is in flight at a time. A failed chunk rejects its own callers only.
 *
 * Invariants:
 *  - ORIGIN: a batch request is only used when the server advertises
 *    `features.attachment_batch_delete_origin` (its batch broadcasts carry the
 *    caller's device id, so this device drops its own echoes). Otherwise each
 *    path is sent as a single DELETE, serially, which always carried it.
 *  - VAULT: each delete carries the vault the CALLER stamped (the same id its
 *    durable queue entry uses). A chunk is never sent while another vault is
 *    active; its callers get `VaultSwitchedError` and re-queue it.
 *  - ORDER: `settled(path)` resolves only once no delete for that path is
 *    pending, queued or in flight, so an upload of the same path can wait it
 *    out (delete then recreate must never delete the new file).
 *  - UNLOAD: `takeUnacked()` hands back every delete not yet acknowledged
 *    (window, queued chunks AND the in-flight one) for durable persistence,
 *    and leaves uploads waiting on those paths parked.
 */

import { isAlreadyGone, statusOf } from "./error-util";
import { rlog } from "./remote-log";

export const ATTACHMENT_DELETE_WINDOW_MS = 100;
/** Paths per request. The server's cap is 500. */
export const ATTACHMENT_DELETE_CHUNK = 200;

/** The vault changed between the delete request and its send. Never sent. */
export class VaultSwitchedError extends Error {
	constructor(readonly vaultId: string | null) {
		super("Vault switched before the attachment delete was sent");
		this.name = "VaultSwitchedError";
	}
}

type Pending = {
	path: string;
	vaultId: string | null;
	resolve: () => void;
	reject: (e: unknown) => void;
};

export type AttachmentDeleteBatcherDeps = {
	/** Send one chunk. `vaultId` is the vault the deletes were requested in. */
	send: (paths: string[], vaultId: string | null) => Promise<void>;
	/** One single DELETE (carries the device id on every backend). */
	sendOne: (path: string, vaultId: string | null) => Promise<void>;
	/** Whether the server's batch-delete stamps the origin device id. */
	batchEnabled: () => boolean;
	activeVaultId: () => string | null;
	setTimeout: (cb: () => void, ms: number) => number;
	clearTimeout: (id: number) => void;
};

type Chunk = { vaultId: string | null; items: Pending[] };

export class AttachmentDeleteBatcher {
	private pending: Pending[] = [];
	/** Chunks formed by flush() and not yet started, in send order. */
	private queued: Chunk[] = [];
	private inFlight: Chunk | null = null;
	/** Paths with a delete not yet settled, with how many. */
	private unsettled = new Map<string, number>();
	private timer: number | null = null;
	private chain: Promise<void> = Promise.resolve();
	/** Set by takeUnacked(): the plugin is going away. */
	private unloading = false;

	constructor(private readonly deps: AttachmentDeleteBatcherDeps) {}

	/** `vaultId`: the vault the caller's durable queue stamps on this delete. */
	delete(path: string, vaultId: string | null): Promise<void> {
		return new Promise((resolve, reject) => {
			this.pending.push({ path, vaultId, resolve, reject });
			this.unsettled.set(path, (this.unsettled.get(path) ?? 0) + 1);
			this.timer ??= this.deps.setTimeout(
				() => void this.flush(),
				ATTACHMENT_DELETE_WINDOW_MS,
			);
		});
	}

	/** Send everything requested so far; resolves when it has all settled. */
	flush(): Promise<void> {
		if (this.timer !== null) this.deps.clearTimeout(this.timer);
		this.timer = null;
		const batch = this.pending;
		this.pending = [];
		if (batch.length === 0) return this.chain;
		const byVault = new Map<string | null, Pending[]>();
		for (const p of batch) {
			const group = byVault.get(p.vaultId);
			if (group) group.push(p);
			else byVault.set(p.vaultId, [p]);
		}
		for (const [vaultId, items] of byVault) {
			for (let i = 0; i < items.length; i += ATTACHMENT_DELETE_CHUNK) {
				this.queued.push({ vaultId, items: items.slice(i, i + ATTACHMENT_DELETE_CHUNK) });
			}
		}
		this.chain = this.chain.then(() => this.drain());
		return this.chain;
	}

	/** Unload: every delete not yet acknowledged (the window, queued chunks and
	 *  the in-flight chunk), for the caller to persist. Their promises never
	 *  settle: the plugin is going away and the durable copy is now the delete.
	 *  A replayed in-flight delete that did land is a server no-op. */
	takeUnacked(): { path: string; vaultId: string | null }[] {
		if (this.timer !== null) this.deps.clearTimeout(this.timer);
		this.timer = null;
		const taken = [
			...(this.inFlight?.items ?? []),
			...this.queued.flatMap((c) => c.items),
			...this.pending,
		];
		this.pending = [];
		this.queued = [];
		this.inFlight = null;
		this.unloading = true;
		// `unsettled` is deliberately kept: an upload waiting on one of these
		// paths must stay parked, or it could land before its own saved delete
		// replays on the next start (and that replay would delete it).
		return taken.map(({ path, vaultId }) => ({ path, vaultId }));
	}

	/** Resolves once no delete for `path` is pending, queued or in flight. */
	async settled(path: string): Promise<void> {
		while (this.unsettled.has(path)) {
			// Handed off at unload: park for good (never spin on an idle chain).
			if (this.unloading) return new Promise<void>(() => {});
			await this.flush();
		}
	}

	private async drain(): Promise<void> {
		for (let c = this.queued.shift(); c; c = this.queued.shift()) {
			this.inFlight = c;
			await this.sendChunk(c);
			// takeUnacked() may have taken it mid-send: it is no longer ours.
			if (this.inFlight !== c) return;
			this.inFlight = null;
		}
	}

	private async sendChunk({ vaultId, items }: Chunk): Promise<void> {
		try {
			if (this.deps.activeVaultId() !== vaultId) throw new VaultSwitchedError(vaultId);
			const paths = [...new Set(items.map((c) => c.path))];
			if (this.deps.batchEnabled()) await this.deps.send(paths, vaultId);
			else {
				for (const p of paths) {
					try {
						await this.deps.sendOne(p, vaultId);
					} catch (e) {
						if (!isAlreadyGone(e)) throw e;
					}
				}
			}
			if (this.inFlight?.items === items) this.settle(items, (c) => c.resolve());
		} catch (e) {
			rlog().warn(
				"api",
				`Attachment delete chunk failed for ${items.length} paths: status=${statusOf(e) ?? "none"}`,
			);
			if (this.inFlight?.items === items) this.settle(items, (c) => c.reject(e));
		}
	}

	private settle(chunk: Pending[], fn: (c: Pending) => void): void {
		for (const c of chunk) {
			const n = (this.unsettled.get(c.path) ?? 1) - 1;
			if (n <= 0) this.unsettled.delete(c.path);
			else this.unsettled.set(c.path, n);
			fn(c);
		}
	}
}

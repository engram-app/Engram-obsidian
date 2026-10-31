/**
 * Coalesces attachment deletes into `POST /attachments/batch-delete`.
 *
 * A folder delete fires one vault event per file, and each used to become its
 * own `DELETE /attachments/<path>`: 407 in about a minute on 2026-10-31, each
 * taking the server's per-vault seq lock. Calls made within WINDOW_MS are
 * grouped, split per vault, and sent CHUNK paths at a time, one request in
 * flight. The server treats a missing path as a no-op, so every caller in a
 * delivered chunk resolves; a failed chunk rejects its own callers only.
 *
 * Invariants:
 *  - VAULT: each delete keeps the vault active when it was REQUESTED. A chunk
 *    is never sent while another vault is active (the token is vault-bound and
 *    the delete would land in the wrong vault); its callers get
 *    `VaultSwitchedError` instead and the caller's durable queue decides.
 *  - ORDER: `settled(path)` resolves only once no delete for that path is
 *    pending OR in flight, so an upload of the same path can wait it out
 *    (delete then recreate must never delete the new file).
 *  - OWN ECHO: paths this device deleted are remembered for ECHO_MEMORY_MS so
 *    the sync engine can drop the server's delete broadcast for them when it
 *    carries no device id (older backends do not stamp batch broadcasts).
 */

import { statusOf } from "./error-util";
import { rlog } from "./remote-log";

export const ATTACHMENT_DELETE_WINDOW_MS = 100;
/** Paths per request. The server's cap is 500. */
export const ATTACHMENT_DELETE_CHUNK = 200;
/** How long a delivered delete counts as this device's own for echo drops. */
export const ATTACHMENT_ECHO_MEMORY_MS = 60_000;

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
	/** Fallback for a backend without the batch route (404 on it). */
	sendOne: (path: string, vaultId: string | null) => Promise<void>;
	activeVaultId: () => string | null;
	now: () => number;
	setTimeout: (cb: () => void, ms: number) => number;
	clearTimeout: (id: number) => void;
};

export class AttachmentDeleteBatcher {
	private pending: Pending[] = [];
	/** Paths with a delete pending or in flight, with how many. */
	private unsettled = new Map<string, number>();
	private timer: number | null = null;
	private chain: Promise<void> = Promise.resolve();
	private batchUnsupported = false;
	/** path -> expiry of "this device deleted it". */
	private ownDeletes = new Map<string, number>();

	constructor(private readonly deps: AttachmentDeleteBatcherDeps) {}

	delete(path: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this.pending.push({ path, vaultId: this.deps.activeVaultId(), resolve, reject });
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
		this.chain = this.chain.then(async () => {
			for (const [vaultId, items] of byVault) {
				for (let i = 0; i < items.length; i += ATTACHMENT_DELETE_CHUNK) {
					await this.sendChunk(vaultId, items.slice(i, i + ATTACHMENT_DELETE_CHUNK));
				}
			}
		});
		return this.chain;
	}

	/** Unload: remove every delete still waiting in the window, unsent, so the
	 *  caller can persist them. Their promises never settle: the plugin is
	 *  going away and the durable copy is now the delete. */
	takePending(): { path: string; vaultId: string | null }[] {
		if (this.timer !== null) this.deps.clearTimeout(this.timer);
		this.timer = null;
		const taken = this.pending;
		this.pending = [];
		for (const p of taken) {
			const n = (this.unsettled.get(p.path) ?? 1) - 1;
			if (n <= 0) this.unsettled.delete(p.path);
			else this.unsettled.set(p.path, n);
		}
		return taken.map(({ path, vaultId }) => ({ path, vaultId }));
	}

	/** Resolves once no delete for `path` is pending or in flight. */
	async settled(path: string): Promise<void> {
		while (this.unsettled.has(path)) await this.flush();
	}

	/** Whether this device deleted `path` recently (consumes the record). */
	consumeOwnDelete(path: string): boolean {
		const until = this.ownDeletes.get(path);
		if (until === undefined) return false;
		this.ownDeletes.delete(path);
		return until >= this.deps.now();
	}

	private async sendChunk(vaultId: string | null, chunk: Pending[]): Promise<void> {
		try {
			if (this.deps.activeVaultId() !== vaultId) throw new VaultSwitchedError(vaultId);
			const paths = [...new Set(chunk.map((c) => c.path))];
			if (this.batchUnsupported) await this.sendEach(paths, vaultId);
			else {
				try {
					await this.deps.send(paths, vaultId);
				} catch (e) {
					if (statusOf(e) !== 404) throw e;
					// compat(server): no batch-delete route. Missing paths are a 200
					// there, so a 404 can only mean the route is absent.
					this.batchUnsupported = true;
					rlog().warn("api", "batch-delete unsupported; deleting attachments one by one");
					await this.sendEach(paths, vaultId);
				}
			}
			const until = this.deps.now() + ATTACHMENT_ECHO_MEMORY_MS;
			for (const p of paths) this.ownDeletes.set(p, until);
			this.settle(chunk, (c) => c.resolve());
		} catch (e) {
			rlog().warn(
				"api",
				`Attachment batch delete failed for ${chunk.length} paths: status=${statusOf(e) ?? "none"}`,
			);
			this.settle(chunk, (c) => c.reject(e));
		}
	}

	private async sendEach(paths: string[], vaultId: string | null): Promise<void> {
		for (const p of paths) {
			try {
				await this.deps.sendOne(p, vaultId);
			} catch (e) {
				if (statusOf(e) !== 404) throw e; // already gone
			}
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

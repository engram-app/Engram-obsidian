/**
 * Durable queue of notes whose local edit is waiting for the server's Yjs
 * lineage. One entry per noteId. The edit text lives on disk, so the entry is
 * what tells us to replay it after a restart: `put`/`delete` resolve only once
 * `save` has persisted.
 */
export type PendingEntry = {
	noteId: string;
	path: string;
	vaultId: string;
	base: string | null;
	baseHash: number | null;
	enqueuedAt: number;
	source: "disk" | "editor" | "create-transfer" | "cold-start" | "migration";
	/** Set only for source "migration" and "editor". */
	text?: string;
};

export class PendingIngestStore {
	private readonly entries = new Map<string, PendingEntry>();
	/** Saves run strictly one after another, each snapshotting at run time, so a
	 *  slow earlier write can never land after (and overwrite) a newer one. */
	private tail: Promise<void> = Promise.resolve();

	constructor(
		load: () => PendingEntry[],
		private readonly save: (all: PendingEntry[]) => Promise<void>,
	) {
		for (const e of load()) this.entries.set(e.noteId, e);
	}

	get(noteId: string): PendingEntry | undefined {
		return this.entries.get(noteId);
	}

	/** Coalesce: keep the OLDEST base/baseHash/enqueuedAt (the merge base for the
	 *  first unsent edit), take the newest path/text/source. */
	async put(e: PendingEntry): Promise<void> {
		const old = this.entries.get(e.noteId);
		this.entries.set(
			e.noteId,
			old ? { ...e, base: old.base, baseHash: old.baseHash, enqueuedAt: old.enqueuedAt } : e,
		);
		// A rejected put keeps the new entry in memory: a later save persists it.
		await this.persist();
	}

	async delete(noteId: string): Promise<void> {
		const old = this.entries.get(noteId);
		if (!old) return;
		this.entries.delete(noteId);
		try {
			await this.persist();
		} catch (err) {
			// Still on disk, so it must stay replayable: roll back (unless re-put since).
			if (!this.entries.has(noteId)) this.entries.set(noteId, old);
			throw err;
		}
	}

	private persist(): Promise<void> {
		const run = this.tail.then(() => this.save([...this.entries.values()]));
		this.tail = run.catch(() => {});
		return run;
	}

	forVault(vaultId: string): PendingEntry[] {
		return [...this.entries.values()].filter((e) => e.vaultId === vaultId);
	}
}

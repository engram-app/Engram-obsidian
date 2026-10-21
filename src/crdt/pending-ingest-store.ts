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
		await this.save([...this.entries.values()]);
	}

	async delete(noteId: string): Promise<void> {
		if (!this.entries.delete(noteId)) return;
		await this.save([...this.entries.values()]);
	}

	forVault(vaultId: string): PendingEntry[] {
		return [...this.entries.values()].filter((e) => e.vaultId === vaultId);
	}
}

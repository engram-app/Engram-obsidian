/**
 * Persisted set of folder paths the server has marked as "explicit empty
 * folders" (kind='folder' rows in the notes table). Polled from
 * GET /folders/explicit on initial sync; consulted by removeEmptyFolders
 * to exempt user-intended empties from cleanup.
 *
 * Persists through the same DataAdapter shape BaseStore uses (read/write).
 * Tolerates missing or malformed state by starting empty.
 */

import type { BaseStoreAdapter } from "./base-store";

export class ExplicitFolders {
	private set = new Set<string>();

	constructor(
		private adapter: BaseStoreAdapter,
		private path: string,
	) {}

	/** Load from disk. Tolerates missing file or malformed JSON. */
	async load(): Promise<void> {
		try {
			const raw = await this.adapter.read(this.path);
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed) && parsed.every((x): x is string => typeof x === "string")) {
				this.set = new Set(parsed);
				return;
			}
		} catch {
			// Missing file or corrupt JSON — fall through to empty.
		}
		this.set = new Set();
	}

	has(path: string): boolean {
		return this.set.has(path);
	}

	all(): string[] {
		return Array.from(this.set);
	}

	async add(path: string): Promise<void> {
		this.set.add(path);
		await this.persist();
	}

	async delete(path: string): Promise<void> {
		this.set.delete(path);
		await this.persist();
	}

	async replaceAll(paths: readonly string[]): Promise<void> {
		this.set = new Set(paths);
		await this.persist();
	}

	private async persist(): Promise<void> {
		await this.adapter.write(this.path, JSON.stringify(Array.from(this.set)));
	}
}

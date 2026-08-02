/** Persistent set of paths the user has explicitly chosen to skip syncing.
 *
 *  Distinct from `EngramSyncSettings.ignorePatterns` — that's a textarea of
 *  literal path prefix/suffix rules the user edits by hand. This is per-file state populated from
 *  the Sync Center "Ignore" button, so users can quietly skip a single
 *  oversize PDF without writing a pattern for it. Excluded from
 *  `isSyncable` and `computeSyncPlan` so the file disappears from "to push"
 *  counts and never reappears in Issues.
 */
export class IgnoredFiles {
	private set: Set<string> = new Set();

	add(path: string): void {
		this.set.add(path);
	}

	remove(path: string): void {
		this.set.delete(path);
	}

	has(path: string): boolean {
		return this.set.has(path);
	}

	size(): number {
		return this.set.size;
	}

	clear(): void {
		this.set.clear();
	}

	/** Sorted (alphabetical) so the Sync Center renders a stable list. */
	all(): string[] {
		return Array.from(this.set).sort();
	}

	serialize(): string[] {
		return this.all();
	}

	hydrate(data: unknown): void {
		this.set.clear();
		if (!Array.isArray(data)) return;
		for (const entry of data) {
			if (typeof entry === "string") this.set.add(entry);
		}
	}
}

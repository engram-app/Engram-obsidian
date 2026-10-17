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

/** Persisted shape. A bare array is the pre-alias format, still loaded. */
interface StoredFolders {
	folders: string[];
	aliases: Record<string, string>;
}

export class ExplicitFolders {
	/** SERVER folder names (what GET /folders/explicit lists). */
	private set = new Set<string>();
	/** Local path -> the name the server stored it under, for the folders the
	 *  server's sanitizer rewrote. "" = the server refused it (it sanitizes to
	 *  the vault root): tracked so it is never resent, never mapped to a server
	 *  folder. Without this the server name looks like a foreign folder and the
	 *  local one like a remote delete on every resync. */
	private aliases = new Map<string, string>();

	constructor(
		private adapter: BaseStoreAdapter,
		private path: string,
	) {}

	/** Load from disk. Tolerates missing file or malformed JSON. */
	async load(): Promise<void> {
		this.set = new Set();
		this.aliases = new Map();
		try {
			const raw = await this.adapter.read(this.path);
			const parsed = JSON.parse(raw) as unknown;
			if (isStringArray(parsed)) {
				this.set = new Set(parsed);
				return;
			}
			const stored = parsed as Partial<StoredFolders> | null;
			if (stored && isStringArray(stored.folders)) {
				this.set = new Set(stored.folders);
				for (const [local, server] of Object.entries(stored.aliases ?? {})) {
					if (typeof server === "string") this.aliases.set(local, server);
				}
			}
		} catch {
			// Missing file or corrupt JSON — fall through to empty.
		}
	}

	/** True for a local path this vault tracks: a server name, or a local
	 *  folder the server renamed or refused. */
	has(path: string): boolean {
		return this.set.has(path) || this.aliases.has(path);
	}

	/** The server name for a tracked local path ("" if the server refused it). */
	serverName(path: string): string {
		return this.aliases.get(path) ?? path;
	}

	/** Server names that a renamed local folder already stands for: a resync
	 *  must not materialize them as a second folder. */
	aliasedServerNames(): Set<string> {
		return new Set([...this.aliases.values()].filter((s) => s !== ""));
	}

	/** [local, server] for every tracked folder the server holds. */
	localEntries(): [string, string][] {
		const aliased = this.aliasedServerNames();
		const plain = [...this.set]
			.filter((s) => !aliased.has(s))
			.map((s): [string, string] => [s, s]);
		const renamed = [...this.aliases].filter(([, s]) => s !== "");
		return [...plain, ...renamed];
	}

	/** Server names (what the server lists). */
	all(): string[] {
		return Array.from(this.set);
	}

	async add(path: string): Promise<void> {
		await this.record([[path, path]]);
	}

	/** add() for many paths with a single persist. */
	async addAll(paths: readonly string[]): Promise<void> {
		await this.record(paths.map((p): [string, string] => [p, p]));
	}

	/** Record [localPath, serverName] pairs from a create response, one persist.
	 *  serverName "" records a refusal. */
	async record(pairs: readonly (readonly [string, string])[]): Promise<void> {
		for (const [local, server] of pairs) {
			if (local === server) {
				this.aliases.delete(local);
			} else {
				this.aliases.set(local, server);
			}
			if (server !== "") this.set.add(server);
		}
		await this.persist();
	}

	/** Forget a local path (and the server name it stood for). */
	async delete(path: string): Promise<void> {
		this.set.delete(this.serverName(path));
		this.aliases.delete(path);
		await this.persist();
	}

	/** Replace the server names with the server's list. An alias whose server
	 *  name is gone goes with it; refusals stay, the server never had them. */
	async replaceAll(paths: readonly string[]): Promise<void> {
		this.set = new Set(paths);
		for (const [local, server] of this.aliases) {
			if (server !== "" && !this.set.has(server)) this.aliases.delete(local);
		}
		await this.persist();
	}

	private async persist(): Promise<void> {
		const stored: StoredFolders = {
			folders: Array.from(this.set),
			aliases: Object.fromEntries(this.aliases),
		};
		await this.adapter.write(this.path, JSON.stringify(stored));
	}
}

function isStringArray(x: unknown): x is string[] {
	return Array.isArray(x) && x.every((v): v is string => typeof v === "string");
}

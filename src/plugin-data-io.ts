// Resilient IO for the plugin's data.json (Phase C0 hardening).
//
// Obsidian's saveData() → adapter.write() is NOT atomic: a quit or crash
// mid-write can truncate data.json to 0 bytes, after which loadData() throws
// "Unexpected end of JSON input" and the whole plugin fails to load — taking
// sync down globally. data.json holds non-resyncable creds (apiKey, vaultId,
// deviceId), so we recover from a backup before falling back to defaults rather
// than silently starting fresh.
//
// atomicWriteJson stages a .tmp, demotes the live file to .bak, then renames
// .tmp over the primary. Every crash window leaves a parseable primary OR .bak.
// resilientReadJson reads primary → .bak → .tmp and reports the source so the
// caller can warn the user on a recovery or on true data loss.

/** The slice of Obsidian's DataAdapter we need. Kept minimal so tests can use a
 *  tiny in-memory fake and so we never depend on the full obsidian surface. */
export interface JsonIoAdapter {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	remove(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

/** Where the recovered data came from:
 *  - "primary": the live file parsed fine (normal path).
 *  - "backup" / "tmp": the primary was missing/empty/corrupt; a fallback parsed.
 *  - "absent": no file existed at all (fresh install) — not an error.
 *  - "corrupt": files existed but none parsed (true data loss) — warn loudly. */
export type ReadSource = "primary" | "backup" | "tmp" | "absent" | "corrupt";

export interface ResilientReadResult<T> {
	data: T | null;
	source: ReadSource;
}

function bakPath(path: string): string {
	return `${path}.bak`;
}

function tmpPath(path: string): string {
	return `${path}.tmp`;
}

/** Atomically write `data` as JSON to `path`, retaining the previous content in
 *  `${path}.bak`. Throws if the underlying adapter fails; on the final-promote
 *  failure the primary is left untouched (old good content), never truncated. */
export async function atomicWriteJson(
	adapter: JsonIoAdapter,
	path: string,
	data: unknown,
): Promise<void> {
	const tmp = tmpPath(path);
	const bak = bakPath(path);

	// 1. Stage the new content in a temp file. A crash here leaves the primary
	//    untouched; the stale .tmp is ignored on next read unless it is the only
	//    parseable copy.
	await adapter.write(tmp, JSON.stringify(data));

	// 2. Demote the current primary to .bak (rename can't overwrite, so clear an
	//    old .bak first). A crash between here and step 3 leaves no primary but a
	//    valid .bak (and the staged .tmp) — both recoverable.
	if (await adapter.exists(path)) {
		if (await adapter.exists(bak)) await adapter.remove(bak);
		await adapter.rename(path, bak);
	}

	// 3. Promote the staged content to the primary (atomic rename).
	await adapter.rename(tmp, path);
}

async function tryReadParse<T>(
	adapter: JsonIoAdapter,
	path: string,
): Promise<{
	parsed: T | null;
	existed: boolean;
}> {
	let raw: string;
	try {
		raw = await adapter.read(path);
	} catch {
		return { parsed: null, existed: false };
	}
	if (raw.trim() === "") return { parsed: null, existed: true };
	try {
		return { parsed: JSON.parse(raw) as T, existed: true };
	} catch {
		return { parsed: null, existed: true };
	}
}

/** Read JSON from `path`, falling back to `${path}.bak` then `${path}.tmp` if the
 *  primary is missing, empty, or corrupt. Reports where the data came from. */
export async function resilientReadJson<T>(
	adapter: JsonIoAdapter,
	path: string,
): Promise<ResilientReadResult<T>> {
	const candidates: Array<[string, Exclude<ReadSource, "absent" | "corrupt">]> = [
		[path, "primary"],
		[bakPath(path), "backup"],
		[tmpPath(path), "tmp"],
	];

	let anyExisted = false;
	for (const [candidate, source] of candidates) {
		const { parsed, existed } = await tryReadParse<T>(adapter, candidate);
		anyExisted = anyExisted || existed;
		if (parsed !== null) return { data: parsed, source };
	}

	// Nothing parsed. Distinguish a fresh install (no files) from data loss
	// (files present but all unreadable) so the caller can warn only on the latter.
	return { data: null, source: anyExisted ? "corrupt" : "absent" };
}

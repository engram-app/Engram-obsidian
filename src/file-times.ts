/**
 * The one reader of a vault file's times, and the one place the wire names
 * `mtime` / `ctime` (epoch SECONDS, what the backend's `Engram.FileTime`
 * takes; Obsidian's stat is milliseconds) are spelled for CRDT messages.
 *
 * A time the platform does not report (0 or absent: adapter-only files, some
 * mobile stats) is OMITTED, never sent as 0 (the server reads 0 as "unknown"
 * and stores the epoch). Times are metadata only: the plugin never compares a
 * server time, and its identical-push skips key on content hashes, so a
 * changed mtime on identical content cannot start a push loop.
 */
export type FileTimes = { mtime?: number; ctime?: number };

/** Resolves the times to attach to a message for `docId` (and `path`, when the
 *  message names one). Returns `{}` when the file or its stat is unknown. */
export type FileTimesResolver = (docId: string, path?: string) => FileTimes;

type Statted = { stat?: { mtime?: number; ctime?: number } } | null | undefined;

export function fileTimes(file: Statted): FileTimes {
	const { mtime, ctime } = file?.stat ?? {};
	return {
		...(mtime !== undefined && mtime > 0 ? { mtime: mtime / 1000 } : {}),
		...(ctime !== undefined && ctime > 0 ? { ctime: ctime / 1000 } : {}),
	};
}

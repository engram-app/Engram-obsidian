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
 *
 * Every ms-to-seconds conversion of a file time goes through `msToSeconds`
 * (a source test fails on a second copy).
 */
export type FileTimes = { mtime?: number; ctime?: number };

/** Resolves the times to attach to a message for `docId` (and `path`, when the
 *  message names one). `live` marks a live edit frame (`liveEditTimes`).
 *  Returns `{}` when the file or its stat is unknown. */
export type FileTimesResolver = (docId: string, path?: string, live?: boolean) => FileTimes;

/** Obsidian reports file times in milliseconds, Engram takes seconds. */
export function msToSeconds(ms: number): number {
	return ms / 1000;
}

type Statted = { stat?: { mtime?: number; ctime?: number } } | null | undefined;

export function fileTimes(file: Statted): FileTimes {
	const { mtime, ctime } = file?.stat ?? {};
	return {
		...(mtime !== undefined && mtime > 0 ? { mtime: msToSeconds(mtime) } : {}),
		...(ctime !== undefined && ctime > 0 ? { ctime: msToSeconds(ctime) } : {}),
	};
}

/**
 * Times for a LIVE edit frame (`crdt_msg`): mtime is `max(file mtime, now)`.
 * Obsidian writes the file ~2 s after the last keystroke, so at send time the
 * file's stat is still the PREVIOUS save's; the server only moves a note's
 * mtime forward, so a short edit would never update it. Queued offline edits
 * (`crdt_doc_update`) and creates keep the file's own stat (`fileTimes`).
 *
 * Clock skew: the server ignores any frame time past its now + 1 day
 * (`Engram.FileTime.from_frame/2`), so a sane clock never trips it, and a
 * clock more than a day fast just loses the time (no worse than before).
 * `now` is floored to whole seconds.
 */
export function liveEditTimes(file: Statted, nowMs: number = Date.now()): FileTimes {
	const times = fileTimes(file);
	return { ...times, mtime: Math.max(times.mtime ?? 0, Math.floor(msToSeconds(nowMs))) };
}

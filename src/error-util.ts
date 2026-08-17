/**
 * A quoted run containing a separator — the shape a filesystem error uses to
 * name the file it failed on. Deliberately requires the separator: `'read'` and
 * `"note.md"` are not paths, and blanking them would cost the diagnostic for
 * nothing.
 */
const QUOTED_PATH = /(['"`])[^'"`]*[/\\][^'"`]*\1/g;

/**
 * A Node filesystem error rendered as a message:
 *   ENOENT: no such file or directory, open '/home/t/vault/Medical/biopsy.md'
 * Group 1 is the code, group 2 the human half. Everything from the syscall
 * onward is the path and is dropped.
 */
const FS_ERROR = /^([A-Z][A-Z0-9]{2,}):\s*(.*?),\s*\w+\s+['"`].*$/s;

/**
 * Coerce an unknown caught value to a printable string, WITHOUT the path.
 *
 * This function is the reason the rest of the privacy work holds. `errMsg(e)`
 * is interpolated into ~85 places, around forty of them log lines that sit
 * directly beside a `noteRef()` — and Obsidian's vault adapter surfaces raw
 * Node errors, whose messages end in the absolute path:
 *
 *   ENOENT: no such file or directory, open '/home/t/vault/Medical/biopsy.md'
 *
 * So every one of those lines shipped the path it had just taken care to wrap.
 * Review caught it; the wrapped-ref work was cosmetic until this was fixed.
 *
 * Scrubbing HERE rather than at the call sites is deliberate: this is the one
 * seam all of them route through, so a new `${errMsg(e)}` is safe by default
 * instead of safe-if-remembered.
 *
 * The code and the human half are kept — `ENOENT: no such file or directory`
 * is the whole diagnostic; the path only ever said which note, which
 * `noteRef()` already says opaquely.
 *
 * It is a scrub of KNOWN shapes, not a proof. A library that embeds a path
 * mid-sentence with no quotes and no separator is not caught. Paths in logs
 * are prevented at the call sites (`noteRef`) and in the anomaly path
 * (slug validation); this closes the shape that actually occurred.
 */
export function errMsg(e: unknown): string {
	return scrubPaths(rawMessage(e));
}

function rawMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (typeof e === "string") return e;
	try {
		return JSON.stringify(e) ?? String(e);
	} catch {
		return String(e);
	}
}

function scrubPaths(message: string): string {
	const fs = FS_ERROR.exec(message);
	if (fs) return `${fs[1]}: ${fs[2]}`;
	return message.replace(QUOTED_PATH, "'<path>'");
}

/** The HTTP status carried by a rejected Obsidian requestUrl() call, or
 *  undefined for non-HTTP failures (network loss, timeout). Null-safe: a
 *  nullish rejection yields undefined, never a TypeError. */
export function statusOf(e: unknown): number | undefined {
	if (typeof e !== "object" || e === null) return undefined;
	const s = (e as { status?: unknown }).status;
	return typeof s === "number" ? s : undefined;
}

/** True when the caught value is an HTTP response with the given status. */
export function isHttpStatus(e: unknown, status: number): boolean {
	return statusOf(e) === status;
}

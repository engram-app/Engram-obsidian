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
 * An UNQUOTED path, anchored on a vault file extension.
 *
 * `QUOTED_PATH` only sees a path a library was polite enough to quote. A
 * message like `failed to index Medical/2026 biopsy results.md after retry`
 * has the same disclosure with no quotes anywhere, and nothing above catches
 * it.
 *
 * Anchored on the EXTENSIONS a vault holds rather than on "any dotted token
 * with a slash", and that restraint is the point: `src/sync.ts:412` and
 * `https://cdn.example.com/lib.js` are the shapes an over-eager version eats,
 * and a stack frame is exactly the diagnostic you still want when the path is
 * gone. Vault extensions and source extensions do not overlap, so anchoring
 * here separates them cleanly.
 *
 * Spaces are allowed INSIDE the run (vault names have them constantly) but a
 * segment separator is still required, so a bare `note.md` with no folder is
 * left alone — it names no folder, which is the part that discloses.
 */
const VAULT_EXT =
	"md|canvas|base|txt|pdf|png|jpe?g|gif|svg|webp|bmp|mp[34]|m4a|wav|ogg|webm|mov|zip|docx|xlsx|pptx";

const BARE_PATH = new RegExp(
	`(?:[A-Za-z]:)?[^\\s'"\`,;:()\\[\\]]*[/\\\\][^'"\`,;:()\\[\\]]*?\\.(?:${VAULT_EXT})\\b`,
	"gi",
);

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
 * It is a scrub of KNOWN shapes, not a proof. Three are covered: the Node fs
 * rendering, any quoted run holding a separator, and an unquoted run ending in
 * a vault file extension. What is still NOT caught, stated plainly because a
 * comment that overstates its reach is what let this class survive seven
 * review rounds:
 *
 *   * a folder with no file — `sync failed under Medical/` has no extension
 *   * a vault file with an extension outside `VAULT_EXT`, or none at all
 *   * a path split across interpolations before it ever reaches here
 *
 * All three require the path to be UNQUOTED. Every quoted form is already
 * clean regardless of extension, because `QUOTED_PATH` keys on the separator
 * and not the suffix — verified against quoted weird-extension, quoted
 * no-extension and quoted folder-only inputs.
 *
 * That is why they are left open rather than chased. Node quotes the path in
 * every fs error, Obsidian's adapter surfaces Node's, and our own code cannot
 * produce the unquoted form because the source guard forces `noteRef` at the
 * call site. The remaining shape needs a third party to write a vault path
 * into prose with no quotes — which nothing we depend on has been observed to
 * do. Closing it would mean scrubbing ANY token holding a separator, which
 * certainly destroys `application/json`, `src/sync.ts:412` and every URL, in
 * exchange for a disclosure nobody has seen.
 *
 * If a path IS ever observed in client logs, the fix is exact rather than
 * broader: give `errMsg` the known path as a second argument and redact that
 * literal string. The ~40 sites that matter already hold it — they sit beside
 * a `noteRef(path)` call. Do that, not a greedier regex.
 *
 * Paths in logs are prevented at the CALL SITES (`noteRef`, enforced by the
 * source guard) and in the anomaly path (slug validation). This function is
 * the backstop for text we do not author, not the primary control.
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
	return message.replace(QUOTED_PATH, "'<path>'").replace(BARE_PATH, "<path>");
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

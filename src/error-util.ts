/**
 * A quoted run holding a path separator — the shape a filesystem error uses to
 * name the file it failed on.
 *
 * One alternative PER DELIMITER, each excluding only its OWN quote character.
 * A single class excluding all three (`[^'"`]*`) cannot match a double-quoted
 * path containing an apostrophe, and `Medical/Tom's notes.md` is an entirely
 * ordinary Obsidian title — so the previous version leaked the common case
 * while its tests, which used apostrophe-free names, reported it clean.
 *
 * Spans are length-bounded. They are anchored by their delimiter so they were
 * never the runaway that `BARE_PATH` was, but an unbounded class in a scrub
 * that runs synchronously on the renderer thread is not worth the argument.
 */
const QUOTED_PATH =
	/'[^']{0,512}[/\\][^']{0,512}'|"[^"]{0,512}[/\\][^"]{0,512}"|`[^`]{0,512}[/\\][^`]{0,512}`/g;

/**
 * A Node filesystem error rendered as a message:
 *   ENOENT: no such file or directory, open '/home/t/vault/Medical/biopsy.md'
 * Group 1 is the code, group 2 the human half.
 */
const FS_ERROR = /^([A-Z][A-Z0-9]{2,}):\s*(.*?),\s*\w+\s+['"`].*$/s;

/**
 * Coerce an unknown caught value to a printable string, WITHOUT the path.
 *
 * `errMsg(e)` is interpolated into ~85 places, around forty of them log lines
 * sitting directly beside a `noteRef()`. Obsidian's vault adapter surfaces raw
 * Node errors whose messages end in the absolute path, so without this those
 * lines shipped the path they had just taken care to wrap — into `client_logs`,
 * CloudWatch and Loki, outside the per-user encryption boundary.
 *
 * ## Pass `knownPath` wherever you have it
 *
 * The second argument is the mechanism that actually works. It redacts that
 * exact string, so it is complete by construction: it does not care whether the
 * path was quoted, what extension it has, whether it has one at all, or whether
 * it is a folder. It cannot damage a diagnostic it was not given, and it cannot
 * backtrack.
 *
 * The ~29 sites that log about a specific note already hold the path — they sit
 * next to `noteRef(path)`. Pass it there. Everything below is the fallback for
 * text where we genuinely do not know which note it concerns.
 *
 * ## Why there is no unquoted-path heuristic
 *
 * There was one. `BARE_PATH` matched an unquoted run ending in a vault file
 * extension, and review killed it on three independent counts:
 *
 *   * **It was a ReDoS.** Greedy class, separator, then a LAZY class that did
 *     not exclude whitespace, so the tail was rescanned per backtrack point —
 *     roughly cubic. 6.4 KB of input took 57 SECONDS, synchronously, on the
 *     renderer thread. A base64 attachment body or an HTML error page echoed
 *     into a message reaches that size easily.
 *   * **It leaked the common case anyway.** Both classes excluded `'`, `"`,
 *     backtick, `,`, `;`, `:`, `(`, `)`, `[`, `]` — every one of which is legal
 *     in a note title. `Medical/Tom's notes.md`, `Medical/Q&A (2026).md` and
 *     `Medical/Notes, 2026.md` all passed through in clear.
 *   * **It ate diagnostics.** Because the lazy class crossed spaces, any `/`
 *     earlier in a message merged with any vault extension later:
 *     `POST /api/notes returned 500 for note.md` became `POST <path>`.
 *
 * A heuristic that leaks ordinary titles, destroys routes and freezes the UI is
 * worse than no heuristic. `knownPath` covers the sites that matter, exactly.
 *
 * ## What is left uncovered, honestly
 *
 * With no `knownPath`, an UNQUOTED path in third-party prose survives. Node
 * quotes the path in every fs error and Obsidian surfaces Node's, so the
 * quoted rule covers what is actually produced — but this is a real gap, not a
 * closed one, and the fix for any instance of it is to pass `knownPath` at that
 * call site rather than to reach for another regex.
 *
 * A path in a non-`message` field of an arbitrary object is JSON-encoded before
 * it gets here, and the resulting `\"` escapes can confuse the quoted rule.
 * `knownPath` is immune to that too.
 */
type PathLike = string | { path: string } | null | undefined;

export function errMsg(e: unknown, knownPath?: PathLike | PathLike[]): string {
	const known = (Array.isArray(knownPath) ? knownPath : [knownPath]).map(pathOf).filter(Boolean);
	return scrubPaths(rawMessage(e), known);
}

function pathOf(value: PathLike): string {
	if (!value) return "";
	return typeof value === "string" ? value : (value.path ?? "");
}

function rawMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (typeof e === "string") return e;

	// Prefer a string `message` over JSON-encoding the whole object. A rejected
	// `requestUrl()` hands back a plain object with one, and encoding it first
	// turns `"` into `\"` — whose backslash then satisfies the quoted rule's
	// separator test, so it matched the wrong span and left the path behind.
	if (e && typeof e === "object") {
		const message = (e as { message?: unknown }).message;
		if (typeof message === "string") return message;
	}

	try {
		return JSON.stringify(e) ?? String(e);
	} catch {
		return String(e);
	}
}

function scrubPaths(message: string, knownPaths: string[]): string {
	// Exact and first. `split`/`join` rather than a built regex so a path
	// containing regex metacharacters — `Q&A (2026).md`, `[draft] plan.md` —
	// is matched literally instead of blowing up or silently not matching.
	//
	// An array because a rename failure can legitimately name either side, and
	// picking one would have left the other in clear. Longest first, so a path
	// that is a prefix of another cannot redact half of it and strand the tail.
	const exact = [...knownPaths]
		.sort((a, b) => b.length - a.length)
		.reduce((acc, path) => acc.split(path).join("<path>"), message);

	const fs = FS_ERROR.exec(exact);
	// The quoted rule runs over the human half as well. The early return used to
	// skip every rule below it, so `ENOENT: cannot copy '/v/Medical/a.md', open
	// '/v/x'` kept the first path in clear.
	//
	// This does NOT make the half safe on its own: an UNQUOTED path there is
	// still the general unquoted gap, and only `knownPath` closes it. Said
	// plainly because the first version of this comment implied otherwise.
	if (fs) return `${fs[1]}: ${(fs[2] ?? "").replace(QUOTED_PATH, "'<path>'")}`;

	return exact.replace(QUOTED_PATH, "'<path>'");
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

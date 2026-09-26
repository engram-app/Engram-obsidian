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

/**
 * Rule A — a quoted run that is a path. Kept identical to the server's
 * `Engram.Logs.TextScrubber` and the SPA Sentry scrub.
 *
 * A quote only OPENS at a boundary (start, whitespace, or `( [ { = : ,`) and
 * only CLOSES at one (end, whitespace, or `) ] } , . ; : |`), so the apostrophe
 * in `can't`/`won't` never pairs up and eats the `| key=value` fields between.
 * One alternative per delimiter so `"Medical/Tom's notes.md"` still matches.
 * The content class excludes its own quote and newline, so a failed close
 * backtracks at most one span — linear. Slash presence, the 512-per-side bound
 * and the API-route exemption are checked in `redactQuoted`, not in the regex.
 */
const EGRESS_QUOTED =
	/(^|[\s([{=:,])(?:'([^'\n]{1,1025})'|"([^"\n]{1,1025})"|`([^`\n]{1,1025})`)(?=$|[\s)\]},.;:|])/g;

/** An API route is signal, not a vault path. Lowercase only. */
const API_ROUTE = /^\/api(\/[a-z0-9_:.-]*)*$/;

function redactQuoted(
	match: string,
	pre: string,
	single?: string,
	double?: string,
	tick?: string,
): string {
	const content = single ?? double ?? tick ?? "";
	const quote = single !== undefined ? "'" : double !== undefined ? '"' : "`";
	if (API_ROUTE.test(content)) return match;
	// Some separator with at most 512 chars on each side of it.
	for (let i = 0; i < content.length; i++) {
		const c = content[i];
		if ((c === "/" || c === "\\") && i <= 512 && content.length - i - 1 <= 512) {
			return `${pre}${quote}<path>${quote}`;
		}
	}
	return match;
}

/**
 * Rule C — a home-directory or Windows-drive path, unquoted. Either one names
 * the OS user or sits outside anything a route could look like, so it is
 * redacted up to the next `|` field separator or end of line — the remainder
 * may contain spaces (`/Users/alice/My Vault/…`). One greedy negated class after
 * a literal anchor: linear. `\b` keeps `https://` from reading as `s:/`.
 */
const HOME_OR_DRIVE_PATH = /(?:~|\/Users|\/home|\b[A-Za-z]:(?=[\\/]))[\\/][^\n|]*/gi;

/** Note/attachment extensions a vault file token can end in. */
const VAULT_EXT =
	/\.(?:md|markdown|canvas|base|excalidraw|txt|rtf|csv|tsv|json|html?|xml|pdf|epub|docx?|xlsx?|pptx?|odt|ods|odp|key|pages|numbers|png|jpe?g|gif|bmp|svg|webp|avif|heic|heif|tiff?|mp3|wav|ogg|m4a|flac|aac|mp4|mov|webm|mkv|avi|zip)$/i;

const TRAILING_PUNCT = new Set([",", ".", ";", ":", ")", "]", "}", '"', "'"]);
/** How far back a spaced title may reach for its folder token. */
const MAX_BACKWALK = 8;

function stripTrailingPunct(token: string): string {
	// A loop, not `/[…]+$/`: that regex is quadratic on a long punctuation run.
	let end = token.length;
	while (end > 0 && TRAILING_PUNCT.has(token[end - 1] ?? "")) end--;
	return token.slice(0, end);
}

const hasSep = (t: string) => t.includes("/") || t.includes("\\");
const isField = (t: string) => t.includes("|") || t.includes("=");

/**
 * Rule B — an unquoted vault path whose title contains spaces. For each token
 * ending in a vault extension, walk back ≤8 tokens to the nearest token with a
 * separator (the folder part), extend over directly-preceding separator tokens,
 * never crossing a `|`/`=` field token, and redact the whole span. No slash in
 * the window → only the extension token goes. Plain token scans with a bounded
 * back-walk, and each token lands in at most one span: linear.
 */
function redactSpacedPaths(line: string): string {
	if (!line.includes(".")) return line;
	const toks = line.split(" ");
	// Loops, not `out.push(...slice)`: spreading a 100k-token slice is slow and
	// throws RangeError past the engine's argument limit.
	const out: string[] = [];
	const emit = (from: number, to: number) => {
		for (let k = from; k < to; k++) out.push(toks[k] ?? "");
	};
	let floor = 0; // first token not yet emitted
	for (let i = 0; i < toks.length; i++) {
		const tok = toks[i] ?? "";
		if (!tok.includes(".") || !VAULT_EXT.test(stripTrailingPunct(tok))) continue;
		let start = i;
		for (let j = i; j >= Math.max(floor, i - MAX_BACKWALK); j--) {
			const tok = toks[j] ?? "";
			if (j < i && isField(tok)) break;
			if (hasSep(tok)) {
				start = j;
				while (
					start > floor &&
					hasSep(toks[start - 1] ?? "") &&
					!isField(toks[start - 1] ?? "")
				) {
					start--;
				}
				break;
			}
		}
		emit(floor, start);
		out.push("<path>");
		floor = i + 1;
	}
	emit(floor, toks.length);
	return out.join(" ");
}

/**
 * Last-line scrub for text LEAVING THE DEVICE (remote-log `message`/`stack`).
 *
 * The call-site rule is still `noteRef(path)` and `errMsg(e, path)`; this is the
 * guarantee for the sites that forget. It is deliberately more aggressive than
 * `errMsg`'s fallback (see "Why there is no unquoted-path heuristic" above): it
 * only runs on egress, where losing a token is cheap and leaking one is not, and
 * every rule is linear so neither the old ReDoS nor its route-eating applies.
 *
 * Remaining honest gap: a spaced title at the vault ROOT with no slash anywhere
 * (`Divorce settlement draft.md`) leaks all but its last word — there is no
 * folder token to anchor the span on. `knownPath` at the call site is the fix.
 */
export function scrubLogText(text: string): string {
	return text
		.replace(EGRESS_QUOTED, redactQuoted)
		.replace(HOME_OR_DRIVE_PATH, (m) => (m.endsWith(" ") ? "<path> " : "<path>"))
		.split("\n")
		.map(redactSpacedPaths)
		.join("\n");
}

/**
 * Reduce a stack to its frames. A V8 stack's header is `Name: <message>` —
 * the raw, unscrubbed error message, which is exactly where an fs error puts
 * the absolute path. Keep only the error name, then the frames, then scrub the
 * frames too. JSC (iOS) stacks have no header and pass through the scrub.
 */
export function scrubStack(stack: string): string {
	const lines = stack.split("\n");
	const firstFrame = lines.findIndex((l) => /^\s*at\s/.test(l));
	if (firstFrame <= 0) return scrubLogText(stack);
	const name = /^[\w$.]+(?=:|$)/.exec(lines[0] ?? "")?.[0] ?? "Error";
	return scrubLogText([name, ...lines.slice(firstFrame)].join("\n"));
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

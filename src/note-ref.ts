/**
 * Opaque, correlatable references to notes for LOG LINES.
 *
 * A vault path is the most revealing thing this plugin knows. `Medical/`,
 * `Divorce 2026/`, `Job search/` — the folder name gives up the sensitive fact
 * without anyone reading the note. Bodies, titles and paths are encrypted at
 * rest with per-user keys; logging the path in clear puts it in `client_logs`,
 * CloudWatch and Loki, outside that boundary.
 *
 * What a sync bug needs from a log line is WHICH note, WHAT failed, and whether
 * it is one note or a hundred. A path answers none of those better than an
 * opaque token does — it is just the format we happened to log.
 *
 * ## Why a counter and not a hash
 *
 * The first version was `fnv1a(sessionSalt + path)`. That is broken by
 * construction, and review demonstrated it recovering real paths:
 *
 *   FNV-1a is a streaming hash with NO finalization, so a salt prefix only sets
 *   the 32-bit initial state. The round `h = (h ^ c) * 0x01000193` is odd, hence
 *   invertible mod 2^32 — run it backwards over any ONE known (path, ref) pair
 *   and the salted state falls out exactly. Every other ref in that session is
 *   then a dictionary lookup. Salting bought nothing against an attacker with a
 *   single pair, and log lines hand those out.
 *
 * A per-session counter has no state to invert and no preimage to search. `n7`
 * is not derived from the path at all; it is a label handed out in first-seen
 * order. The map is the only thing that could reverse it, and it never leaves
 * the process.
 *
 * Correlation within a session — the window a sync investigation lives in — is
 * exactly preserved: the same path always gets the same label. It deliberately
 * does NOT correlate across devices or restarts. For that use `noteId`, which
 * is already an opaque UUID and already in scope on the CRDT paths.
 */

/** Bounded so a large vault cannot turn a debug aid into a memory leak. Past
 *  the cap, refs degrade to `n?` — correlation is lost, privacy is not. */
const MAX_TRACKED = 10_000;

const labels = new Map<string, string>();

/** A file-like with a vault path — `TFile` and our own row shapes both fit. */
type PathLike = { path: string };

function pathOf(value: string | PathLike | null | undefined): string {
	if (!value) return "";
	return typeof value === "string" ? value : (value.path ?? "");
}

/**
 * An opaque per-session reference to a note, safe to log.
 *
 * Use it wherever a path used to be interpolated:
 * `rlog().warn("push", \`push failed for ${noteRef(file)}\`)`.
 */
export function noteRef(value: string | PathLike | null | undefined): string {
	const path = pathOf(value);
	if (!path) return "n?";

	const existing = labels.get(path);
	if (existing) return existing;
	if (labels.size >= MAX_TRACKED) return "n?";

	const label = `n${labels.size + 1}`;
	labels.set(path, label);
	return label;
}

/** Test-only: drop the label table so a suite can assert first-seen numbering
 *  without depending on what ran before it. */
export function __resetNoteRefs(): void {
	labels.clear();
}

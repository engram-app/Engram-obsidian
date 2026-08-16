import { fnv1a } from "./content-hash";

/**
 * Opaque, correlatable references to notes for LOG LINES.
 *
 * A vault path is the most revealing thing this plugin knows. `Medical/`,
 * `Divorce 2026/`, `Job search/` — the folder name gives up the sensitive fact
 * without anyone reading the note. Note bodies, titles and paths are encrypted
 * at rest with per-user keys; logging the path in clear puts it in
 * `client_logs`, CloudWatch and Loki, outside that boundary.
 *
 * What a sync bug actually needs from a log line is: WHICH note, WHAT failed,
 * and whether it is one note or a hundred. A human-readable path answers none
 * of those better than a stable opaque token does — it is just the format we
 * happened to log.
 *
 * ## The token
 *
 * `fnv1a(sessionSalt + path)`, base-36. The salt is random per plugin session,
 * lives only in memory, and is never sent anywhere — so the token cannot be
 * brute-forced back to a path by anyone holding the logs, which a bare hash of
 * a short string like "Medical" absolutely could be.
 *
 * Stable for the life of a session, which is the window a sync investigation
 * lives in. It deliberately does NOT correlate across devices or restarts: for
 * that you want `noteId`, which is already an opaque UUID and already in scope
 * on the CRDT paths.
 *
 * 32 bits collides somewhere around a few tens of thousands of distinct paths
 * in one session. That is fine for grouping log lines and is not fine for
 * anything else — do not use this as an identity.
 *
 * Not a security boundary on its own. It is the "never log the path" rule made
 * convenient, so the rule survives contact with a developer in a hurry.
 */
const SESSION_SALT = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

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
	return `n${fnv1a(SESSION_SALT + path).toString(36)}`;
}

/**
 * Structure without identity — extension and folder depth.
 *
 * For the handful of lines where the SHAPE of the path was the signal (a
 * deeply nested folder, an unexpected extension) rather than which note it was.
 * Neither field can name a folder.
 */
export function noteShape(value: string | PathLike | null | undefined): string {
	const path = pathOf(value);
	if (!path) return "ext=? depth=0";
	const dot = path.lastIndexOf(".");
	const slash = path.lastIndexOf("/");
	const ext = dot > slash && dot !== -1 ? path.slice(dot + 1).toLowerCase() : "none";
	const depth = path.split("/").length - 1;
	// Bounded so a pathological name cannot itself become the payload.
	return `ext=${ext.slice(0, 12)} depth=${depth}`;
}

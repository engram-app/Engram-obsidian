/**
 * File-kind predicates shared across the sync engine, CRDT wiring, live views
 * and search. Free functions (no Obsidian imports) so every layer can use the
 * same definition — a new CRDT-eligible extension previously had to be added
 * at 3+ inline sites.
 */

export function isMarkdownPath(path: string): boolean {
	return path.endsWith(".md");
}

export function isCanvasPath(path: string): boolean {
	return path.endsWith(".canvas");
}

/** CRDT-eligible = markdown OR canvas: both sync over the Yjs transport (the
 *  manager's docKind picks the per-type schema). Binary/attachment types are
 *  NOT eligible and stay on the REST/attachment path. */
export function isCrdtEligiblePath(path: string): boolean {
	return isMarkdownPath(path) || isCanvasPath(path);
}

/** The Y.Doc schema for a CRDT-eligible path. */
export function docKindFor(path: string): "note" | "canvas" {
	return isCanvasPath(path) ? "canvas" : "note";
}

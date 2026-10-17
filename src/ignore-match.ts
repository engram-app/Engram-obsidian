/**
 * ignore-match.ts: the pure path matchers behind `SyncEngine.shouldIgnore`,
 * shared with the folder picker so its counts are exactly what will sync.
 */

/** Key of the "(top level)" pseudo-folder holding notes at the vault root. */
export const ROOT_FOLDER = "";

/** Does one `ignorePatterns` line match `path`? A trailing "/" is a folder
 *  prefix, anything else an exact file name; both match at the root or nested.
 *  Neither glob nor regex. */
export function matchesIgnorePattern(path: string, pattern: string): boolean {
	if (pattern.endsWith("/")) {
		return path.startsWith(pattern) || path.includes(`/${pattern}`);
	}
	return path === pattern || path.endsWith(`/${pattern}`);
}

/** Is `path` inside one of the excluded top-level folders? Anchored at the
 *  vault root: "Archive" is not "Projects/Archive" nor "Archived". The root
 *  pseudo-folder excludes nothing, root notes always sync. */
export function inExcludedFolder(path: string, excluded: Iterable<string>): boolean {
	for (const f of excluded) if (f !== ROOT_FOLDER && path.startsWith(`${f}/`)) return true;
	return false;
}

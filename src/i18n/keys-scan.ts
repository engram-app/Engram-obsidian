/**
 * Every key passed to `t("...")` or `tInto(el, "...")` in the given sources.
 * Shared by tests/i18n-keys.test.ts (orphan guard) and scripts/i18n-translate.ts.
 *
 * `tInto` needs its own pattern: `\bt\(` does not match inside `tInto(`, so a
 * scanner that only knows `t()` reports every `tInto` key as an orphan.
 * Single quotes need their own pattern too: a key containing a double quote is
 * written `t('... "{name}" ...')`.
 */
import type { Dict } from ".";

export interface Entry {
	key: string;
	/** Set when `en-plurals.ts` lists the key: the English singular to translate `one` from. */
	plural?: { one?: string };
}

const PATTERNS = [
	/\bt\(\s*"((?:[^"\\]|\\.)+)"/g,
	/\bt\(\s*'((?:[^'\\]|\\.)+)'/g,
	/\btInto\([^,]+,\s*"((?:[^"\\]|\\.)+)"/g,
	/\btInto\([^,]+,\s*'((?:[^'\\]|\\.)+)'/g,
];

export function usedKeys(sources: readonly string[]): Set<string> {
	const keys = new Set<string>();
	for (const src of sources) {
		for (const pattern of PATTERNS) {
			for (const m of src.matchAll(pattern)) {
				const key = m[1];
				if (key) keys.add(key.replace(/\\(["'])/g, "$1"));
			}
		}
	}
	return keys;
}

/** Keys in first-seen order, each plural one carrying its English `one` form. */
export function usedEntries(sources: readonly string[], enPlurals: Dict): Entry[] {
	return [...usedKeys(sources)].map((key) => {
		const forms = enPlurals[key];
		return typeof forms === "object" ? { key, plural: { one: forms.one } } : { key };
	});
}

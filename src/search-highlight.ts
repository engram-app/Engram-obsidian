/** Pure helpers for rendering match highlights. No DOM. */

export interface HighlightSegment {
	text: string;
	hit: boolean;
}

/** Split `text` into ordered hit / non-hit segments from sorted ranges. */
export function buildSegments(text: string, ranges: [number, number][]): HighlightSegment[] {
	if (!ranges.length) return [{ text, hit: false }];
	const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
	const out: HighlightSegment[] = [];
	let cursor = 0;
	for (const [s, e] of sorted) {
		if (s < cursor) continue; // skip overlaps
		if (s > cursor) out.push({ text: text.slice(cursor, s), hit: false });
		out.push({ text: text.slice(s, e), hit: true });
		cursor = e;
	}
	if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
	return out;
}

/** Whole-word, case-insensitive ranges of each query token within `text`.
 *  Word-boundary matching avoids partial-word noise (e.g. "name" ≠ "filename").
 *  Single-char tokens are skipped. */
export function queryTokenRanges(text: string, query: string): [number, number][] {
	const ranges: [number, number][] = [];
	for (const raw of query.split(/\s+/)) {
		const token = raw.trim();
		if (token.length < 2) continue;
		const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(`\\b${esc}\\b`, "gi");
		let m = re.exec(text);
		while (m !== null) {
			ranges.push([m.index, m.index + m[0].length]);
			m = re.exec(text);
		}
	}
	return ranges.sort((a, b) => a[0] - b[0]);
}

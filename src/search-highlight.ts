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

/** Semantic fallback: ranges of each query token within `text`, case-insensitive. */
export function queryTokenRanges(text: string, query: string): [number, number][] {
	const lower = text.toLowerCase();
	const ranges: [number, number][] = [];
	for (const tokenRaw of query.split(/\s+/)) {
		const token = tokenRaw.toLowerCase().trim();
		if (!token) continue;
		let from = 0;
		let i = lower.indexOf(token, from);
		while (i >= 0) {
			ranges.push([i, i + token.length]);
			from = i + token.length;
			i = lower.indexOf(token, from);
		}
	}
	return ranges.sort((a, b) => a[0] - b[0]);
}

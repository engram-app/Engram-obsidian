// The one place markdown note text changes line endings.
//
// A note's Y.Doc holds LF only (the Relay model, src/diskText.ts there):
// INCOMING text is converted once, where it enters the doc (`seedContentInto`,
// which every disk read, push, genesis and merge goes through). Same rule as
// CodeMirror's line splitter, so a lone CR converts as well. Markdown only:
// canvas and binaries stay byte-exact. The server converts with the same rule.
//
// One healer: CRs ALREADY in a doc (a doc from before this rule, or a live
// update from an old plugin) are removed by the server room process and by
// nobody else. Healing a lone CR is a delete plus an insert, which two actors
// doing it concurrently merge to two line breaks. So every other writer diffs
// against the doc's LF VIEW and maps the edits back to raw offsets (`lfView`),
// and never emits an op on a CR that is already there.

/** `text` with every CRLF pair and every lone CR as LF. */
export function toLf(text: string): string {
	return hasCr(text) ? text.replace(/\r\n?/g, "\n") : text;
}

export function hasCr(text: string): boolean {
	return text.includes("\r");
}

/** `raw` as LF (`view`), plus `rawAt`, the raw offset where view offset `v`
 *  begins: a view LF that is a CRLF pair maps to its CR, so an insert there
 *  lands before the pair and a delete of it takes the whole pair. Identity
 *  for a raw text with no CR. ponytail: O(text) per call; only a doc that
 *  still holds a CR pays it, until the room's heal lands. */
export function lfView(raw: string): { view: string; rawAt: (v: number) => number } {
	if (!hasCr(raw)) return { view: raw, rawAt: (v) => v };
	const starts: number[] = [];
	let view = "";
	for (let i = 0; i < raw.length; i++) {
		starts.push(i);
		if (raw[i] === "\r") {
			view += "\n";
			if (raw[i + 1] === "\n") i++;
		} else {
			view += raw[i];
		}
	}
	starts.push(raw.length);
	return { view, rawAt: (v) => starts[v] ?? raw.length };
}

export interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

/** Edits against `lfView(raw).view` (all against that same text, the
 *  CodeMirror ChangeSet shape) mapped onto `raw`'s offsets. Inserts stay LF. */
export function lfEditsToRaw(raw: string, edits: TextEdit[]): TextEdit[] {
	if (!hasCr(raw)) return edits;
	const { rawAt } = lfView(raw);
	return edits.map((e) => ({ from: rawAt(e.from), to: rawAt(e.to), insert: e.insert }));
}

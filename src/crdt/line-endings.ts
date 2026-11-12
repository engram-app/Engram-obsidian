// The one place note text changes line endings.
//
// A note's Y.Text keeps the note's own bytes, CRLF included: the server, the
// web app and REST/MCP writes all store them as-is, so rewriting them here
// would mint an edit on every CRLF note and fork its lineage. CodeMirror, on
// the other hand, holds every document with LF breaks. The live binding works
// in the editor's LF view and maps through here into the doc's coordinates.
//
// Relay normalizes to LF at ingest instead (src/diskText.ts), which works for
// it because its plugin is the only writer of note text. Ours shares the doc
// with three writers that keep CRLF, so the conversion lives at the editor
// boundary, the one place that sees LF.

/** `text` as the editor holds it: every CRLF pair as LF. */
export function toLf(text: string): string {
	return text.includes("\r") ? text.replace(/\r\n/g, "\n") : text;
}

export interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

/** Map edits against `toLf(doc)` (all against the same pre-edit text, the
 *  CodeMirror ChangeSet shape) onto `doc`'s own offsets. A line break the
 *  editor deletes takes its whole CRLF pair, and inserted LF breaks become CRLF
 *  when the doc already uses CRLF. Identity for an LF doc.
 *  ponytail: O(doc length) per call; only CRLF notes pay it. */
export function lfEditsToDoc(doc: string, edits: TextEdit[]): TextEdit[] {
	if (!doc.includes("\r\n")) return edits;
	// crlfBefore[k] = CRLF pairs in doc before LF-view offset k. Built once.
	const lfLen = doc.length - (doc.match(/\r\n/g)?.length ?? 0);
	const shift = new Uint32Array(lfLen + 1);
	let pairs = 0;
	let view = 0;
	for (let i = 0; i < doc.length; i++) {
		if (doc[i] === "\r" && doc[i + 1] === "\n") {
			shift[view] = pairs;
			pairs++;
			i++;
		} else {
			shift[view] = pairs;
		}
		view++;
	}
	shift[lfLen] = pairs;
	const at = (k: number) => k + (shift[Math.min(k, lfLen)] ?? pairs);
	return edits.map((e) => ({
		from: at(e.from),
		to: at(e.to),
		insert: e.insert.replace(/\r?\n/g, "\r\n"),
	}));
}

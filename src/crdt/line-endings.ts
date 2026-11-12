// The one place markdown note text changes line endings.
//
// A note's Y.Doc holds LF only (the Relay model, src/diskText.ts there): text
// is converted once, where it enters the doc (`seedContentInto`, which every
// disk read, push, genesis and merge base goes through). CodeMirror holds LF
// too, so the editor and the doc agree byte for byte, and every file the
// plugin writes is uniformly LF. Same rule as CodeMirror's line splitter, so
// a lone CR converts as well. Markdown only: canvas and binaries stay
// byte-exact. The server converts with the same rule at its own ingest.

/** `text` with every CRLF pair and every lone CR as LF. */
export function toLf(text: string): string {
	return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}

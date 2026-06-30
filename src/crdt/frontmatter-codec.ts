// Pure codec between a note's YAML frontmatter and the CRDT Y.Map form. Mirrors
// the backend Elixir Engram.Notes.Frontmatter. No Obsidian imports so it is
// unit-testable under bun and reusable.

const FENCE = "---";
// Matches a closing fence line: --- with optional trailing spaces/tabs + optional CR.
const CLOSE_MID = /\n---[ \t]*\r?\n/;
const CLOSE_EOF = /\n---[ \t]*\r?$/;

export function splitFrontmatter(raw: string): { fmBlock: string | null; body: string } {
	if (!raw.startsWith(`${FENCE}\n`)) return { fmBlock: null, body: raw };
	const rest = raw.slice(FENCE.length + 1);
	// Empty frontmatter fast path: rest begins with the closing fence.
	if (rest.startsWith(`${FENCE}\n`)) return { fmBlock: "", body: rest.slice(FENCE.length + 1) };
	const mid = rest.match(CLOSE_MID);
	if (mid && mid.index !== undefined) {
		const block = `${rest.slice(0, mid.index)}\n`;
		const body = rest.slice(mid.index + mid[0].length);
		return { fmBlock: block, body };
	}
	const eof = rest.match(CLOSE_EOF);
	if (eof && eof.index !== undefined) {
		return { fmBlock: `${rest.slice(0, eof.index)}\n`, body: "" };
	}
	return { fmBlock: null, body: raw };
}

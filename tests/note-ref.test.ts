/**
 * Opaque note references for log lines.
 *
 * A vault path is the most revealing thing this plugin knows — `Medical/`,
 * `Divorce 2026/`, `Job search/` give up the sensitive fact without anyone
 * reading the note. Bodies, titles and paths are encrypted at rest with
 * per-user keys; logging the path in clear put it in client_logs, CloudWatch
 * and Loki, outside that boundary.
 *
 * Both directions matter here. A reference nobody can correlate is useless and
 * gets routed around; a reference that leaks the path defeats the point.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { __resetNoteRefs, noteRef } from "../src/note-ref";

const SENSITIVE = [
	"Medical/2026 biopsy results.md",
	"Divorce 2026/settlement draft.md",
	"Job search/resignation letter.md",
	"Therapy/session notes.md",
	"Untitled",
	"📝 Daily Log.md",
];

describe("noteRef — the path never survives", () => {
	test.each(SENSITIVE)("%s leaks no fragment of itself", (path) => {
		const ref = noteRef(path);

		// Every word of the path, and every folder segment.
		for (const word of path.split(/[/\s.]+/).filter((w) => w.length > 2)) {
			expect(ref.toLowerCase()).not.toContain(word.toLowerCase());
		}
		expect(ref).not.toContain("/");
	});

	// The shapes that defeated the redactor this replaced: a filename with
	// spaces lost only its last token, and a basename with no extension
	// survived whole.
	test("a multi-word filename and a bare basename are both opaque", () => {
		expect(noteRef("Divorce settlement draft.md")).not.toContain("Divorce");
		expect(noteRef("Divorce")).not.toContain("Divorce");
	});
});

describe("noteRef — correlation still works", () => {
	test("the same path gives the same ref", () => {
		expect(noteRef("Medical/labs.md")).toBe(noteRef("Medical/labs.md"));
	});

	test("different paths give different refs", () => {
		expect(noteRef("Medical/labs.md")).not.toBe(noteRef("Medical/scan.md"));
	});

	// Call sites pass a TFile as often as a string.
	test("a file-like and its path agree", () => {
		expect(noteRef({ path: "Medical/labs.md" })).toBe(noteRef("Medical/labs.md"));
	});

	test("empty and nullish inputs do not throw", () => {
		for (const value of ["", null, undefined]) {
			expect(noteRef(value)).toBe("n?");
		}
	});
});

describe("noteRef — the MAX_TRACKED cap", () => {
	beforeEach(() => __resetNoteRefs());

	// 10_000 is the cap in note-ref.ts. Asserted by behaviour rather than by
	// importing the constant, so the test still means something if the number
	// moves: what is pinned is that a cap EXISTS and where it bites.
	const CAP = 10_000;
	const fill = () => {
		for (let i = 0; i < CAP; i++) noteRef(`Medical/note-${i}.md`);
	};

	test("a new path past the cap degrades to n? rather than growing", () => {
		fill();
		expect(noteRef("Medical/one too many.md")).toBe("n?");
	});

	// The ordering that matters. The cap check sits AFTER the map lookup, so a
	// note already being followed keeps its ref for the whole session. Hoisting
	// the check above the lookup would make every ref in a large vault go dark
	// at once — the logs would still be private, and completely useless.
	test("a path seen before the cap still resolves after it", () => {
		const first = noteRef("Medical/labs.md");
		fill();

		expect(noteRef("Medical/one too many.md")).toBe("n?");
		expect(noteRef("Medical/labs.md")).toBe(first);
	});

	// The point of the cap is a bounded table, not a bounded label. A
	// degraded ref must still not carry the thing it replaced.
	test("the degraded ref carries no part of the path", () => {
		fill();
		const ref = noteRef("Medical/2026 biopsy results.md");

		expect(ref).toBe("n?");
		for (const marker of ["Medical", "biopsy", "2026", ".md"]) {
			expect(ref).not.toContain(marker);
		}
	});
});

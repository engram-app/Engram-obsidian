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
import { describe, expect, test } from "bun:test";
import { noteRef, noteShape } from "../src/note-ref";

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

describe("noteShape — structure without identity", () => {
	test("reports extension and depth, names no folder", () => {
		const shape = noteShape("Medical/2026/biopsy results.md");

		expect(shape).toBe("ext=md depth=2");
		expect(shape).not.toContain("Medical");
		expect(shape).not.toContain("biopsy");
	});

	test("a file with no extension", () => {
		expect(noteShape("Untitled")).toBe("ext=none depth=0");
	});

	// A dot in a FOLDER name is not an extension.
	test("a dotted folder does not become the extension", () => {
		expect(noteShape("v1.2/notes.md")).toBe("ext=md depth=1");
	});

	// The extension is caller-controlled text, so it is bounded — otherwise a
	// pathological name becomes the payload the function exists to prevent.
	test("a pathological extension is truncated", () => {
		const shape = noteShape(`note.${"x".repeat(200)}`);
		expect(shape.length).toBeLessThan(40);
	});

	test("nullish input does not throw", () => {
		expect(noteShape(null)).toBe("ext=? depth=0");
	});
});

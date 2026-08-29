/**
 * Tests: what to do with a remote update landing on a note that is OPEN (#483
 * defect 1).
 *
 * `wiring.ts` currently skips the disk write for a bound path and nudges
 * Obsidian's own save instead, on the premise that "a remote merge just painted
 * in". That premise holds for the BODY, which the live binding paints from the
 * Y.Text, and fails for the FRONTMATTER, which nothing observes.
 *
 * The failure is worse than "the change does not arrive". `requestSave()` saves
 * the EDITOR BUFFER, which still holds the old frontmatter, so the stale block
 * is written to disk and `seedContentInto` puts it straight back into the doc.
 * The nudge is a revert engine for anything the binding does not paint.
 *
 * So the decision has to be made against what the EDITOR is showing, not against
 * disk: while the user is typing in the frontmatter block, disk is behind and
 * the editor is right, and writing over them would eat the keystrokes.
 */
import { describe, expect, test } from "bun:test";
import { boundFlushDecision } from "../src/crdt/live/live-binding-decisions";

const PROJECTION = "---\nstatus: published\n---\n\nbody text\n";

describe("boundFlushDecision", () => {
	test("frontmatter already shown in the editor -> nudge", () => {
		// The binding painted the body; the frontmatter matches. Obsidian's own
		// save is the right way to get the body to disk without fighting CM.
		const editor = "---\nstatus: published\n---\n\nbody text edited locally\n";
		expect(boundFlushDecision(editor, PROJECTION)).toBe("nudge");
	});

	test("frontmatter moved remotely -> write, because nothing will paint it", () => {
		const editor = "---\nstatus: draft\n---\n\nbody text\n";
		expect(boundFlushDecision(editor, PROJECTION)).toBe("write");
	});

	test("a key ADDED remotely -> write", () => {
		const editor = "---\n---\n\nbody text\n";
		expect(boundFlushDecision(editor, PROJECTION)).toBe("write");
	});

	test("a key REMOVED remotely -> write", () => {
		const editor = "---\nstatus: published\nextra: gone\n---\n\nbody text\n";
		expect(boundFlushDecision(editor, PROJECTION)).toBe("write");
	});

	test("editor text unavailable -> write, never silently revert", () => {
		// No visible editor for the path (a race with the leaf closing, or a view
		// type we cannot read). Nudging would ask Obsidian to save a buffer we
		// could not inspect; writing is the direction that cannot lose the
		// remote change.
		expect(boundFlushDecision(null, PROJECTION)).toBe("write");
	});

	test("body-only divergence -> nudge, the binding owns the body", () => {
		// Live Preview: the CM document is body-only, so there is no block to
		// compare and no frontmatter for the editor to be stale about.
		expect(boundFlushDecision("body text\n", "body text changed\n")).toBe("nudge");
	});

	test("neither side has frontmatter -> nudge", () => {
		expect(boundFlushDecision("plain\n", "plain\n")).toBe("nudge");
	});

	test("comparison is on the BLOCK, not the whole file", () => {
		// Same frontmatter, wildly different bodies: still a nudge. Deciding on
		// whole-file equality would write on every keystroke and fight the editor.
		const editor = "---\nstatus: published\n---\n\ncompletely different\n";
		expect(boundFlushDecision(editor, PROJECTION)).toBe("nudge");
	});
});

import { expect, test } from "bun:test";
import * as Y from "yjs";
import { diffIntoYText, seedOnce } from "../../src/crdt/bridge";

test("diffIntoYText converges to incoming via minimal edits", () => {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	text.insert(0, "the quick brown fox");

	diffIntoYText(text, "the quick red fox jumps");

	expect(text.toString()).toBe("the quick red fox jumps");
});

test("diffIntoYText does NOT full-replace (history preserved)", () => {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	text.insert(0, "hello world");
	const before = Y.encodeStateVector(doc);

	diffIntoYText(text, "hello brave world");

	const after = Y.encodeStateVector(doc);
	expect(after.length).toBeGreaterThan(0);
	expect(text.toString()).toBe("hello brave world");
});

test("seedOnce inserts once, then never again (no duplication)", () => {
	const doc = new Y.Doc();
	const text = doc.getText("content");

	expect(seedOnce(text, "disk content", false)).toBe(true);
	expect(text.toString()).toBe("disk content");

	expect(seedOnce(text, "disk content", true)).toBe(false);
	expect(text.toString()).toBe("disk content");
});

test("two devices editing offline merge with no lost or duplicated text", () => {
	const base = new Y.Doc();
	seedOnce(base.getText("content"), "shared base line", false);
	const baseUpdate = Y.encodeStateAsUpdate(base);

	const a = new Y.Doc();
	Y.applyUpdate(a, baseUpdate);
	const b = new Y.Doc();
	Y.applyUpdate(b, baseUpdate);

	diffIntoYText(a.getText("content"), "shared base line — A edit");
	diffIntoYText(b.getText("content"), "B prefix — shared base line");

	Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

	const aFinal = a.getText("content").toString();
	const bFinal = b.getText("content").toString();

	expect(aFinal).toBe(bFinal);
	expect(aFinal).toContain("A edit");
	expect(aFinal).toContain("B prefix");
	expect(aFinal.match(/shared base line/g)?.length).toBe(1);
});

test("diffIntoYText handles multibyte emoji: edit after emoji lands at correct offset", () => {
	// 🦊 is U+1F98A — a 2 code-unit surrogate pair in UTF-16 (JS string length 2).
	// diff-match-patch operates on JS string indices (UTF-16), matching Y.Text's
	// native UTF-16 offset model, so an edit *after* the emoji must land correctly.
	const doc = new Y.Doc();
	const text = doc.getText("content");
	text.insert(0, "🦊 jumps");

	diffIntoYText(text, "🦊 leaps high");

	expect(text.toString()).toBe("🦊 leaps high");
});

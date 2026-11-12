/**
 * LF-only note docs (the Relay model, approved for Engram-obsidian#697).
 *
 * Markdown text is converted to LF once, where it enters the Y.Doc
 * (`seedContentInto`, which every disk read, push, genesis and merge base
 * goes through). CodeMirror holds LF, so the editor and the doc then agree
 * byte for byte, and nothing ever writes a file with mixed endings. Canvas and
 * binary files are never converted.
 */
import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { CONTENT_KEY, flushTarget, sameNoteMeaning } from "../src/crdt/frontmatter-codec";
import { toLf } from "../src/crdt/line-endings";
import { seedContentInto } from "../src/crdt/note-seed";
import { ProviderRegistry } from "../src/crdt/provider-registry";

describe("toLf", () => {
	test("converts CRLF, a lone CR and mixed endings", () => {
		expect(toLf("a\r\nb\r\n")).toBe("a\nb\n");
		expect(toLf("a\rb\r")).toBe("a\nb\n");
		expect(toLf("a\r\nb\nc\rd\r\r\ne")).toBe("a\nb\nc\nd\n\ne");
		expect(toLf("plain\n")).toBe("plain\n");
	});
});

describe("seedContentInto holds LF only", () => {
	const crlf = "---\r\ntitle: T\r\n---\r\n\r\n# H\r\nline\rtwo\r\n";

	test("a CRLF disk file seeds an LF body and LF-parsed frontmatter", () => {
		const doc = new Y.Doc();
		const text = doc.getText(CONTENT_KEY);
		seedContentInto(doc, text, crlf, false);
		expect(text.toJSON()).toBe("\n# H\nline\ntwo\n");
		expect(doc.getMap("frontmatter").get("title")).toBe('"T"');
	});

	test("an old-plugin CRLF write over an LF doc converges with no further ops", () => {
		const doc = new Y.Doc();
		const text = doc.getText(CONTENT_KEY);
		seedContentInto(doc, text, crlf, false);
		let updates = 0;
		doc.on("update", () => updates++);
		// The old plugin (or Windows) keeps writing the CRLF bytes back to disk.
		seedContentInto(doc, text, crlf, true);
		seedContentInto(doc, text, crlf, true);
		expect(updates).toBe(0);
	});

	test("genesis encodes LF", () => {
		const doc = new Y.Doc();
		Y.applyUpdate(doc, new ProviderRegistry({} as never).encodeGenesisUpdate("a\r\nb\r\n"));
		expect(doc.getText(CONTENT_KEY).toJSON()).toBe("a\nb\n");
	});

	test("a .canvas file is never converted", () => {
		const canvas =
			'{"nodes":[{"id":"n1","type":"text","text":"line one\\r\\nline two"}],"edges":[]}';
		const doc = new Y.Doc();
		Y.applyUpdate(doc, new ProviderRegistry({} as never).encodeGenesisUpdate(canvas, "canvas"));
		const node = doc.getMap("nodes").get("n1") as { text: string };
		expect(node.text).toBe("line one\r\nline two");
	});
});

describe("a CRLF disk file against an LF doc", () => {
	const disk = "---\r\ntitle: T # mine\r\n---\r\n\r\nbody\r\n";
	const projection = "---\ntitle: T\n---\n\nbody\n";

	test("means the same note, so no conflict copy", () => {
		expect(sameNoteMeaning(projection, disk)).toBe(true);
	});

	test("a flush writes one ending only, keeping the user's YAML", () => {
		const { onDisk } = flushTarget(projection, disk);
		expect(onDisk).toBe("---\ntitle: T # mine\n---\n\nbody\n");
		expect(onDisk.includes("\r")).toBe(false);
	});
});

/** The room heal, as the server's room process does it: the only actor that
 *  removes a CR already in a doc. A CRLF pair loses its CR; a lone CR becomes
 *  LF (delete + insert, which only one actor may do). */
function roomHeal(doc: Y.Doc): void {
	const text = doc.getText(CONTENT_KEY);
	const body = text.toJSON();
	doc.transact(() => {
		for (let i = body.length - 1; i >= 0; i--) {
			if (body[i] !== "\r") continue;
			text.delete(i, 1);
			if (body[i + 1] !== "\n") text.insert(i, "\n");
		}
	});
}

function replica(state: Uint8Array): Y.Doc {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, state);
	return doc;
}

function legacyDoc(body: string): Uint8Array {
	const doc = new Y.Doc();
	doc.getText(CONTENT_KEY).insert(0, body);
	return Y.encodeStateAsUpdate(doc);
}

function mergeAll(docs: Y.Doc[]): void {
	for (const a of docs)
		for (const b of docs) if (a !== b) Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe("one healer: only the room removes CRs already in a doc", () => {
	test("a plugin seed racing the room heal on a lone-CR note leaves one line break", () => {
		const state = legacyDoc("a\rb\n");
		const room = replica(state);
		const plugin = replica(state);
		roomHeal(room);
		// An offline edit on the device, made before the room heal reached it.
		seedContentInto(plugin, plugin.getText(CONTENT_KEY), "a\rb\nedit\n", true);
		mergeAll([room, plugin]);
		for (const d of [room, plugin])
			expect(d.getText(CONTENT_KEY).toJSON()).toBe("a\nb\nedit\n");
	});

	test("seeding a CR doc's own text emits no ops on its CRs", () => {
		const doc = replica(legacyDoc("one\r\ntwo\rthree\r\n"));
		let updates = 0;
		doc.on("update", () => updates++);
		seedContentInto(doc, doc.getText(CONTENT_KEY), "one\r\ntwo\rthree\r\n", true);
		seedContentInto(doc, doc.getText(CONTENT_KEY), "one\ntwo\nthree\n", true);
		expect(updates).toBe(0);
	});

	test("a classic-Mac file edited on two devices converges with no doubled breaks", () => {
		const state = legacyDoc("a\rb\rc\r");
		const room = replica(state);
		const a = replica(state);
		const b = replica(state);
		seedContentInto(a, a.getText(CONTENT_KEY), "a\rb\rc\rfrom a\r", true);
		seedContentInto(b, b.getText(CONTENT_KEY), "x\rb\rc\r", true);
		roomHeal(room);
		mergeAll([room, a, b]);
		const texts = [room, a, b].map((d) => d.getText(CONTENT_KEY).toJSON());
		expect(new Set(texts).size).toBe(1);
		expect(texts[0]).not.toContain("\n\n");
		expect(texts[0]).not.toContain("\r");
		expect(texts[0]).toContain("from a\n");
	});
});

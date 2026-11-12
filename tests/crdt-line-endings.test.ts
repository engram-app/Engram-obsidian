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

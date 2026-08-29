// tests/crdt-note-seed-frontmatter.test.ts
//
// seedContentInto is the ONLY writer of the frontmatter shared types, and it is
// the whole reason CrdtFrontmatterHook could be deleted: the hook never wrote
// them, so properties sync has always run through here, off the disk-save path
// (vault modify -> routeModify -> seedContentInto). That path is not gated on
// the note being open: `isBound` only guards the remote->disk direction, so it
// covers open notes too.
//
// These pin that contract. If a future change moves frontmatter ingest back
// behind a view hook, the "no hook needed" premise breaks and these fail.
import { describe, expect, it } from "bun:test";
import * as Y from "yjs";
import { CONTENT_KEY, frontmatterOf } from "../src/crdt/frontmatter-codec";
import { seedContentInto, seedFrontmatterInto } from "../src/crdt/note-seed";

function seed(content: string, doc = new Y.Doc(), lca = false): Y.Doc {
	seedContentInto(doc, doc.getText(CONTENT_KEY), content, lca);
	return doc;
}

describe("seedContentInto frontmatter ingest", () => {
	it("writes frontmatter into the shared types and keeps the body body-only", () => {
		const doc = seed("---\ntags: [a]\ntitle: T\n---\nbody here");
		expect(frontmatterOf(doc).values).toMatchObject({ tags: '["a"]', title: '"T"' });
		expect(frontmatterOf(doc).order).toEqual(["tags", "title"]);
		// The FM block must NOT leak into the body Y.Text (the corruption the
		// deleted hook used to cause by diffing the full file text in).
		expect(doc.getText(CONTENT_KEY).toJSON()).toBe("body here");
	});

	it("applies a properties-only edit without touching the body", () => {
		const doc = seed("---\ntags: [a]\n---\nbody here");
		const before = doc.getText(CONTENT_KEY).toJSON();
		// Second ingest = what the disk-save path does after a properties edit.
		seed("---\ntags: [b]\n---\nbody here", doc, true);
		expect(frontmatterOf(doc).values).toMatchObject({ tags: '["b"]' });
		expect(doc.getText(CONTENT_KEY).toJSON()).toBe(before);
	});

	it("removes a key deleted from the frontmatter", () => {
		const doc = seed("---\ntags: [a]\ndraft: true\n---\nbody");
		seed("---\ntags: [a]\n---\nbody", doc, true);
		expect(frontmatterOf(doc).values).toEqual({ tags: '["a"]' });
	});

	it("adds frontmatter to a note that had none, leaving the body intact", () => {
		const doc = seed("body only");
		expect(frontmatterOf(doc).values).toEqual({});
		seed("---\ntags: [a]\n---\nbody only", doc, true);
		expect(frontmatterOf(doc).values).toMatchObject({ tags: '["a"]' });
		expect(doc.getText(CONTENT_KEY).toJSON()).toBe("body only");
	});

	it("carries a body edit made in the same save as a properties edit", () => {
		const doc = seed("---\ntags: [a]\n---\nold body");
		seed("---\ntags: [b]\n---\nnew body", doc, true);
		expect(frontmatterOf(doc).values).toMatchObject({ tags: '["b"]' });
		expect(doc.getText(CONTENT_KEY).toJSON()).toBe("new body");
	});
});

// #483 defect 2. `seedContentInto` collapsed two opposite facts into one null:
// "this note has no frontmatter" (delete every key: correct) and "this note has
// frontmatter I could not parse" (delete every key: destroys the user's
// properties). Half-typed YAML is invalid constantly, so the destructive branch
// was reachable by ordinary typing, and the projection then wrote a body-only
// note over the file on every device.
//
// The server has never behaved this way: `Frontmatter.parse_for_ingest` keeps
// the good keys and preserves the unparseable one verbatim in the raws map.
describe("unparseable frontmatter is inert, not destructive", () => {
	const BAD = "---\nkeep: me\nbad: [unclosed\n---\nbody";

	it("does not delete keys the doc already holds", () => {
		const doc = seed("---\nkeep: me\nalso: here\n---\nbody");
		seed(BAD, doc, true);
		expect(frontmatterOf(doc).values).toMatchObject({
			keep: '"me"',
			also: '"here"',
		});
	});

	it("leaves the key order intact", () => {
		const doc = seed("---\nkeep: me\nalso: here\n---\nbody");
		seed(BAD, doc, true);
		expect(frontmatterOf(doc).order).toEqual(["keep", "also"]);
	});

	it("does not push the raw fence into the body Y.Text", () => {
		// `body = parsed !== null ? splitBody : content` used the WHOLE file on a
		// failed parse, so the `---` block landed in the body — the fence-in-body
		// shape the server's normalize_doc exists to heal.
		const doc = seed("---\nkeep: me\n---\nbody");
		seed(BAD, doc, true);
		expect(doc.getText(CONTENT_KEY).toJSON()).toBe("body");
	});

	it("still carries a body edit made in the same save", () => {
		// Inert about frontmatter must not mean inert about everything: the user
		// may have typed in the body during the same broken-YAML window.
		const doc = seed("---\nkeep: me\n---\nold body");
		seed("---\nkeep: me\nbad: [unclosed\n---\nnew body", doc, true);
		expect(doc.getText(CONTENT_KEY).toJSON()).toBe("new body");
	});

	it("resumes normally once the YAML parses again", () => {
		const doc = seed("---\nkeep: me\n---\nbody");
		seed(BAD, doc, true);
		seed("---\nkeep: me\nbad: [closed]\n---\nbody", doc, true);
		expect(frontmatterOf(doc).values).toMatchObject({
			keep: '"me"',
			bad: '["closed"]',
		});
	});

	it("a note that genuinely has NO frontmatter still clears its keys", () => {
		// The other half of the null. Deleting the block must still delete the
		// keys, or removing frontmatter would be impossible.
		const doc = seed("---\ngone: soon\n---\nbody");
		seed("body", doc, true);
		expect(frontmatterOf(doc).values).toEqual({});
	});
});

// #483 defect 1, outbound half. `sync.ts:3594` skips the disk-driven CRDT route
// entirely while a note is live-bound:
//
//   if (crdtManaged && this.isLiveBound(file.path)) { ...baseline only...; return }
//
// Right for the BODY — the live binding forwards every keystroke into the
// Y.Text, and re-diffing the whole file every autosave would churn the doc.
// Wrong for the FRONTMATTER, which the binding drops (`classifyEditSpan` ->
// "frontmatter"). Between the two, frontmatter typed into an OPEN note has no
// route to the doc at all, which e2e confirmed: obsidian -> web fails with the
// note open and passes with it closed.
//
// `seedFrontmatterInto` is the narrow half the bound path can safely run: the
// same codec, the same unparseable guard, and it never touches the body.
describe("seedFrontmatterInto (the live-bound ingest half)", () => {
	function fm(content: string, doc = new Y.Doc()): Y.Doc {
		seedFrontmatterInto(doc, content);
		return doc;
	}

	it("ingests frontmatter without creating or touching the body", () => {
		const doc = fm("---\ntags: [a]\n---\nbody here");
		expect(frontmatterOf(doc).values).toMatchObject({ tags: '["a"]' });
		// THE point of the narrow variant: the body is the binding's, not ours.
		expect(doc.getText(CONTENT_KEY).toJSON()).toBe("");
	});

	it("leaves a body the binding already owns completely alone", () => {
		const doc = seed("---\ntags: [a]\n---\ntyped in the editor");
		seedFrontmatterInto(doc, "---\ntags: [b]\n---\nstale disk copy");
		expect(frontmatterOf(doc).values).toMatchObject({ tags: '["b"]' });
		expect(doc.getText(CONTENT_KEY).toJSON()).toBe("typed in the editor");
	});

	it("removes a key deleted while the note was open", () => {
		const doc = seed("---\na: 1\nb: 2\n---\nbody");
		seedFrontmatterInto(doc, "---\na: 1\n---\nbody");
		expect(frontmatterOf(doc).values).toEqual({ a: "1" });
	});

	it("inherits the unparseable guard rather than deleting everything", () => {
		const doc = seed("---\nkeep: me\n---\nbody");
		seedFrontmatterInto(doc, "---\nkeep: me\nbad: [unclosed\n---\nbody");
		expect(frontmatterOf(doc).values).toMatchObject({ keep: '"me"' });
	});

	it("clears the keys when the block is genuinely gone", () => {
		const doc = seed("---\ngone: soon\n---\nbody");
		seedFrontmatterInto(doc, "body");
		expect(frontmatterOf(doc).values).toEqual({});
	});

	it("re-ingesting identical frontmatter mints no ops", () => {
		// This runs on every autosave of an open note, so an identical re-ingest
		// has to be free — otherwise it is the #846 second-lineage trap on a
		// 2-second timer.
		const doc = seed("---\ntags: [a]\n---\nbody");
		const before = Y.encodeStateAsUpdate(doc).length;
		seedFrontmatterInto(doc, "---\ntags: [a]\n---\nbody");
		expect(Y.encodeStateAsUpdate(doc).length).toBe(before);
	});
});

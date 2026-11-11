// The one frontmatter fence rule, asserted against the backend's shared table.
//
// tests/fixtures/frontmatter_fence.json is a byte-for-byte copy of
//   engram-app/Engram native/engram_core/fixtures/frontmatter_fence.json
//   at f5da042627b68aa93fc59067cb42be133e91a6ad (Engram#2564).
// The Rust tests, the backend ExUnit suite and the web vitest assert the same
// file. Drift is caught by the "frontmatter fence table" job in lint.yml, which
// cmp's this copy against engram-app/Engram main. Add cases upstream, then
// re-copy; never add one here only.
import { describe, expect, it, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as Y from "yjs";
import { CONTENT_KEY, frontmatterOf, splitFrontmatter } from "../src/crdt/frontmatter-codec";
import { applyFrontmatterInto, seedContentInto } from "../src/crdt/note-seed";
import { searchEngram } from "../src/search-engine";

interface Case {
	name: string;
	input: string;
	block: string | null;
	body: string;
}
const CASES: Case[] = JSON.parse(
	readFileSync(join(import.meta.dir, "fixtures/frontmatter_fence.json"), "utf8"),
);

test.each(CASES.map((c) => [c.name, c] as const))(
	"splitFrontmatter follows the shared table: %s",
	(_name, { input, block, body }) => {
		expect(splitFrontmatter(input)).toEqual({ fmBlock: block, body });
	},
);

describe("existing CRLF note on first plugin seed after upgrade", () => {
	// The server has always split a CRLF note (its NIF opened on `---\r\n`), so
	// the stored doc holds the keys in the frontmatter map and only the body in
	// the Y.Text. Re-seeding the same disk bytes must mint ZERO ops: no
	// frontmatter clear, no fence text pushed into the body, no second lineage.
	it("mints no CRDT ops", () => {
		const disk = "---\r\ntitle: T\r\n---\r\nline one\r\nline two\r\n";
		const doc = new Y.Doc();
		const text = doc.getText(CONTENT_KEY);
		doc.transact(() => {
			applyFrontmatterInto(doc, ["title"], { title: '"T"' });
			text.insert(0, "line one\r\nline two\r\n");
		});
		let updates = 0;
		doc.on("update", () => updates++);

		seedContentInto(doc, text, disk, true);

		expect(updates).toBe(0);
		expect(text.toString()).toBe("line one\r\nline two\r\n");
		expect(frontmatterOf(doc)).toEqual({ order: ["title"], values: { title: '"T"' } });
	});
});

describe("local keyword search strips frontmatter with the shared rule", () => {
	async function bodyOf(content: string): Promise<string | undefined> {
		const app = {
			vault: {
				getMarkdownFiles: () => [{ path: "n.md" }],
				cachedRead: async () => content,
				getFileByPath: () => ({ path: "n.md" }),
			},
			metadataCache: { getFileCache: () => ({ tags: [], frontmatter: {} }) },
		} as never;
		const { results } = await searchEngram(
			"keyword",
			"zz",
			{ api: {} as never, app },
			{ limit: 10 },
			{ fuzzy: () => () => ({ score: 1, matches: [] }) },
		);
		return results[0]?.text;
	}

	it("keeps a `---foo` line: it never closes the block", async () => {
		const note = "---\ntitle: T\n---foo\nbody";
		// The excerpt collapses whitespace.
		expect(await bodyOf(note)).toBe("--- title: T ---foo body");
	});

	it("strips a CRLF block", async () => {
		expect(await bodyOf("---\r\ntitle: T\r\n---\r\nbody")).toBe("body");
	});
});

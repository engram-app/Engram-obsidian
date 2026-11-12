// The one frontmatter fence rule, asserted against the backend's shared table.
//
// tests/fixtures/frontmatter_fence.json is a byte-for-byte copy of
//   engram-app/Engram native/engram_core/fixtures/frontmatter_fence.json
//   at f5da042627b68aa93fc59067cb42be133e91a6ad (Engram#2564).
// The Rust tests, the backend ExUnit suite and the web vitest assert the same
// file. Drift is caught by the "frontmatter fence table" job in lint.yml, which
// cmp's this copy against engram-app/Engram main (the SHA above is informational:
// the job checks main). Add cases upstream, then re-copy; never add one here only.
import { describe, expect, it, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as Y from "yjs";
import {
	CONTENT_KEY,
	frontmatterOf,
	ORDER_KEY,
	projectNote,
	splitFrontmatter,
} from "../src/crdt/frontmatter-codec";
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
	// The server splits a CRLF note since Engram #1645 (2026-09-15), so a doc
	// ingested after that holds the keys in the frontmatter map and only the
	// body in the Y.Text. Re-seeding the same disk bytes must mint ZERO ops: no
	// frontmatter clear, no fence text pushed into the body, no second lineage.
	// Older docs hold the fence in the body and heal with one edit (below).
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

describe("an old-plugin-damaged CRLF note healed by server and plugin at once", () => {
	// Damaged shape: fence text in the body Y.Text, empty frontmatter map. The
	// server's normalize_doc lifts the fence on room load (appends to
	// frontmatter_order); the upgraded plugin lifts it in seedContentInto. Run
	// concurrently, both order inserts survive the merge: frontmatter_order is a
	// Y.Array, so unlike the Y.Map of values it does not collapse a key.
	it("projects each key once", () => {
		const disk = "---\r\ntitle: T\r\n---\r\nline\r\n";
		const base = new Y.Doc();
		base.getText(CONTENT_KEY).insert(0, disk);
		const state = Y.encodeStateAsUpdate(base);
		const server = new Y.Doc();
		const plugin = new Y.Doc();
		Y.applyUpdate(server, state);
		Y.applyUpdate(plugin, state);

		server.transact(() => {
			server.getMap<string>("frontmatter").set("title", '"T"');
			const arr = server.getArray<string>(ORDER_KEY);
			arr.insert(arr.length, ["title"]);
			server.getText(CONTENT_KEY).delete(0, "---\r\ntitle: T\r\n---\r\n".length);
		});
		seedContentInto(plugin, plugin.getText(CONTENT_KEY), disk, true);

		Y.applyUpdate(server, Y.encodeStateAsUpdate(plugin));
		Y.applyUpdate(plugin, Y.encodeStateAsUpdate(server));

		for (const doc of [server, plugin]) {
			const { order, values } = frontmatterOf(doc);
			expect(projectNote(order, values, doc.getText(CONTENT_KEY).toString())).toBe(
				"---\ntitle: T\n---\nline\r\n",
			);
		}
	});
});

describe("a doc whose frontmatter_order already holds a key twice", () => {
	// Left behind by a concurrent lift (above). Every reader dedupes, first
	// position wins, so seeding the doc's own projection is an echo, not an edit.
	function duplicated(): Y.Doc {
		const doc = new Y.Doc();
		doc.transact(() => {
			doc.getMap<string>("frontmatter").set("title", '"T"');
			doc.getArray<string>(ORDER_KEY).insert(0, ["title", "title"]);
			doc.getText(CONTENT_KEY).insert(0, "line\r\n");
		});
		return doc;
	}
	const projection = (doc: Y.Doc) => {
		const { order, values } = frontmatterOf(doc);
		return projectNote(order, values, doc.getText(CONTENT_KEY).toString());
	};

	it("reads the order once", () => {
		expect(frontmatterOf(duplicated()).order).toEqual(["title"]);
	});

	it("seeding its own unchanged projection mints no ops", () => {
		const doc = duplicated();
		let updates = 0;
		doc.on("update", () => updates++);
		seedContentInto(doc, doc.getText(CONTENT_KEY), projection(doc), true);
		expect(updates).toBe(0);
	});

	it("two devices echoing it at once do not re-create a duplicate", () => {
		const state = Y.encodeStateAsUpdate(duplicated());
		const a = new Y.Doc();
		const b = new Y.Doc();
		Y.applyUpdate(a, state);
		Y.applyUpdate(b, state);
		let updates = 0;
		a.on("update", () => updates++);
		b.on("update", () => updates++);
		seedContentInto(a, a.getText(CONTENT_KEY), projection(a), true);
		seedContentInto(b, b.getText(CONTENT_KEY), projection(b), true);
		expect(updates).toBe(0);
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		for (const doc of [a, b]) expect(projection(doc)).toBe("---\ntitle: T\n---\nline\r\n");
	});
});

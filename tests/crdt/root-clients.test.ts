import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { projectCanvas, seedCanvasInto } from "../../src/crdt/canvas-codec";
import { CONTENT_KEY, FRONTMATTER_KEY } from "../../src/crdt/frontmatter-codec";
import { applyFrontmatterInto } from "../../src/crdt/note-seed";
import { canonText, rootClients } from "../../src/crdt/root-clients";

function docWith(client: number, text: string): Y.Doc {
	const d = new Y.Doc();
	d.clientID = client;
	d.getText(CONTENT_KEY).insert(0, text);
	return d;
}

describe("rootClients", () => {
	test("one lineage edited elsewhere = 1", () => {
		const a = docWith(1, "hello");
		const b = new Y.Doc();
		b.clientID = 2;
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		b.getText(CONTENT_KEY).insert(5, " world");
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		expect([...rootClients(a)]).toEqual([1]);
	});

	test("fresh seed into existing = 2", () => {
		const a = docWith(1, "hello");
		const b = docWith(2, "hello");
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		expect([...rootClients(a)].sort()).toEqual([1, 2]);
	});

	test("clear and retype = 1", () => {
		const a = docWith(1, "hello");
		const t = a.getText(CONTENT_KEY);
		t.delete(0, 5);
		t.insert(0, "again");
		expect([...rootClients(a)]).toEqual([1]);
	});

	test("frontmatter map entries ignored", () => {
		// Client 1 owns the body; client 2 writes frontmatter map entries (real
		// codec) into the SAME doc. Map items are origin-less too, but not body roots.
		const a = docWith(1, "body");
		const b = new Y.Doc();
		b.clientID = 2;
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
		applyFrontmatterInto(b, ["k"], { k: "v" });
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		expect(a.getMap(FRONTMATTER_KEY).get("k")).toBe("v");
		expect([...rootClients(a)]).toEqual([1]);
	});
});

describe("canonText", () => {
	test("adds key: null", () => {
		expect(canonText("---\nkey:\n---\nbody", "note")).toContain("key: null");
	});

	test("canvas round-trips like the registry projection", () => {
		const json = JSON.stringify(
			{
				nodes: [{ id: "n1", type: "text", text: "hi", x: 0, y: 0, width: 10, height: 10 }],
				edges: [],
			},
			null,
			"\t",
		);
		const d = new Y.Doc();
		seedCanvasInto(d, json);
		expect(canonText(json, "canvas")).toBe(projectCanvas(d));
		expect(JSON.parse(canonText(json, "canvas")).nodes[0].id).toBe("n1");
	});
});

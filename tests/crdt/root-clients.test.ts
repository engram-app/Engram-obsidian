import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { CONTENT_KEY } from "../../src/crdt/frontmatter-codec";
import { seedContentInto } from "../../src/crdt/note-seed";
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
		const a = new Y.Doc();
		a.clientID = 1;
		seedContentInto(a, a.getText(CONTENT_KEY), "---\nk: v\n---\n", false);
		const b = new Y.Doc();
		b.clientID = 2;
		b.getMap("frontmatter").set("k", "v");
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		expect(rootClients(a).has(2)).toBe(false);
	});
});

describe("canonText", () => {
	test("adds key: null", () => {
		expect(canonText("---\nkey:\n---\nbody", "note")).toContain("key: null");
	});
});

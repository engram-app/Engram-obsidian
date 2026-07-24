import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { edgesOf, nodesOf, projectCanvas, seedCanvasInto } from "../../src/crdt/canvas-codec";

// A minimal but realistic Obsidian .canvas document. Nodes/edges are keyed by a
// stable `id`; that stability is what lets concurrent edits merge per-element
// instead of char-diffing JSON (which would corrupt it).
const CANVAS = JSON.stringify({
	nodes: [
		{ id: "n1", type: "text", text: "hello", x: 0, y: 0, width: 100, height: 60 },
		{ id: "n2", type: "text", text: "world", x: 200, y: 0, width: 100, height: 60 },
	],
	edges: [{ id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" }],
});

describe("canvas-codec", () => {
	test("seed + project round-trips the canvas data (structural identity)", () => {
		const doc = new Y.Doc();
		expect(seedCanvasInto(doc, CANVAS)).toBe(true);

		// Data identity — whitespace may differ, the parsed structure must not.
		expect(JSON.parse(projectCanvas(doc))).toEqual(JSON.parse(CANVAS));
		// Nodes are keyed structurally, order preserved.
		expect(nodesOf(doc).map((n) => n.id)).toEqual(["n1", "n2"]);
		expect(edgesOf(doc).map((e) => e.id)).toEqual(["e1"]);
	});

	test("project is idempotent (project∘seed∘project == project)", () => {
		const doc = new Y.Doc();
		seedCanvasInto(doc, CANVAS);
		const once = projectCanvas(doc);
		const doc2 = new Y.Doc();
		seedCanvasInto(doc2, once);
		expect(projectCanvas(doc2)).toBe(once);
	});

	test("concurrent per-element edits both survive (the whole point of structural)", () => {
		const a = new Y.Doc();
		seedCanvasInto(a, CANVAS);

		// b starts from a's state (shared history), then each edits independently.
		const b = new Y.Doc();
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

		// a moves n1; b recolors n2 and adds n3 — disjoint elements.
		seedCanvasInto(
			a,
			JSON.stringify({
				nodes: [
					{
						id: "n1",
						type: "text",
						text: "hello",
						x: 999,
						y: 999,
						width: 100,
						height: 60,
					},
					{ id: "n2", type: "text", text: "world", x: 200, y: 0, width: 100, height: 60 },
				],
				edges: [
					{ id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" },
				],
			}),
		);
		seedCanvasInto(
			b,
			JSON.stringify({
				nodes: [
					{ id: "n1", type: "text", text: "hello", x: 0, y: 0, width: 100, height: 60 },
					{
						id: "n2",
						type: "text",
						text: "world",
						x: 200,
						y: 0,
						width: 100,
						height: 60,
						color: "4",
					},
					{ id: "n3", type: "text", text: "new", x: 400, y: 0, width: 100, height: 60 },
				],
				edges: [
					{ id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left" },
				],
			}),
		);

		// Merge both ways.
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

		const nodes = nodesOf(a);
		const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
		expect(byId.n1.x).toBe(999); // a's move survived
		expect(byId.n2.color).toBe("4"); // b's recolor survived
		expect(byId.n3).toBeDefined(); // b's add survived
		// a and b converged.
		expect(projectCanvas(a)).toBe(projectCanvas(b));
	});

	test("removing a node deletes it from the map and order", () => {
		const doc = new Y.Doc();
		seedCanvasInto(doc, CANVAS);
		seedCanvasInto(
			doc,
			JSON.stringify({
				nodes: [
					{ id: "n1", type: "text", text: "hello", x: 0, y: 0, width: 100, height: 60 },
				],
				edges: [],
			}),
		);
		expect(nodesOf(doc).map((n) => n.id)).toEqual(["n1"]);
		expect(edgesOf(doc)).toEqual([]);
	});

	test("preserves unknown top-level keys via canvas_meta", () => {
		const withMeta = JSON.stringify({ nodes: [], edges: [], someFutureKey: { a: 1 } });
		const doc = new Y.Doc();
		seedCanvasInto(doc, withMeta);
		expect(JSON.parse(projectCanvas(doc))).toEqual(JSON.parse(withMeta));
	});

	test("malformed / non-canvas JSON returns false and leaves the doc untouched", () => {
		const doc = new Y.Doc();
		expect(seedCanvasInto(doc, "{not json")).toBe(false);
		expect(seedCanvasInto(doc, JSON.stringify({ nodes: "nope" }))).toBe(false);
		// An element without a stable id can't merge structurally — reject.
		expect(seedCanvasInto(doc, JSON.stringify({ nodes: [{ type: "text" }], edges: [] }))).toBe(
			false,
		);
		expect(nodesOf(doc)).toEqual([]);
	});
});

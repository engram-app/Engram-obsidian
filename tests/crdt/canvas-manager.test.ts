import { expect, test } from "bun:test";
import "fake-indexeddb/auto";
import * as Y from "yjs";
import { CrdtManager } from "../../src/crdt/manager";

// The manager learns a doc's kind once, via the docKind callback (sync.ts wires
// it from the note's path). A ".canvas" note must use the structural schema
// (Y.Map nodes/edges), never the markdown content Y.Text.
function makeCanvasManager(prefix: string) {
	const flushed: Record<string, string> = {};
	const mgr = new CrdtManager({
		dbPrefix: prefix,
		onUpdate: () => {},
		onFlushToDisk: async (p, c) => {
			flushed[p] = c;
		},
		docKind: (id) => (id.endsWith(".canvas") ? "canvas" : "note"),
	});
	return { mgr, flushed };
}

const board = (nodes: unknown[], edges: unknown[] = []) => JSON.stringify({ nodes, edges });
const NODE = { id: "n1", type: "text", text: "hi", x: 0, y: 0, width: 100, height: 60 };

test("applyLocalEdit on a .canvas note seeds nodes map, NOT the markdown content Y.Text", async () => {
	const { mgr } = makeCanvasManager("canvas-seed");
	mgr.markSynced("board.canvas");
	await mgr.applyLocalEdit("board.canvas", board([NODE]));

	const doc = await mgr.getDoc("board.canvas");
	expect(doc.getMap("nodes").has("n1")).toBe(true);
	// The markdown body must stay empty — the JSON was NOT char-ingested.
	expect(doc.getText("content").toString()).toBe("");
	await mgr.destroy();
});

test("remote update on a .canvas note flushes canvas JSON (projectCanvas) to disk", async () => {
	const { mgr, flushed } = makeCanvasManager("canvas-flush");
	mgr.markSynced("board.canvas");
	await mgr.applyLocalEdit("board.canvas", board([NODE]));

	// Peer built from the same state moves n1, sends only the delta back →
	// triggers the REMOTE_ORIGIN flush listener.
	const peer = new Y.Doc();
	Y.applyUpdate(peer, await mgr.encodeStateAsUpdate("board.canvas"));
	peer.getMap("nodes").set("n1", { ...NODE, x: 50, y: 50 });
	const delta = Y.encodeStateAsUpdate(peer, await mgr.encodeStateVector("board.canvas"));
	await mgr.applyRemoteUpdate("board.canvas", delta);

	const written = JSON.parse(flushed["board.canvas"]);
	expect(written.nodes[0].x).toBe(50);
	await mgr.destroy();
});

test("hasHistory reflects canvas structure, not the (always-empty) body Y.Text", async () => {
	const { mgr } = makeCanvasManager("canvas-history");
	mgr.markSynced("board.canvas");
	expect(await mgr.hasHistory("board.canvas")).toBe(false);
	await mgr.applyLocalEdit("board.canvas", board([NODE]));
	expect(await mgr.hasHistory("board.canvas")).toBe(true);
	await mgr.destroy();
});

test("encodeGenesisUpdate(canvas) seeds a peer STRUCTURALLY, not into the markdown body", () => {
	// The batch-genesis path (crdt_create_batch) is the ONE encode site that
	// bypasses docKind, so it must pass kind="canvas" or a peer applies the frame
	// as an empty {nodes,edges} and the canvas silently never materializes (#306).
	const { mgr } = makeCanvasManager("canvas-genesis");
	const frame = mgr.encodeGenesisUpdate(board([NODE]), "canvas");

	const peer = new Y.Doc();
	Y.applyUpdate(peer, frame);
	expect(peer.getMap("nodes").has("n1")).toBe(true);
	// The markdown body Y.Text must be empty — the JSON was NOT char-ingested.
	expect(peer.getText("content").toString()).toBe("");
});

test("projectedText returns the canvas JSON for a .canvas doc", async () => {
	const { mgr } = makeCanvasManager("canvas-project");
	mgr.markSynced("board.canvas");
	await mgr.applyLocalEdit("board.canvas", board([NODE]));
	expect(JSON.parse(await mgr.projectedText("board.canvas"))).toEqual({
		nodes: [NODE],
		edges: [],
	});
	await mgr.destroy();
});

/**
 * A CRLF note opened in the editor (Engram-obsidian#697, e2e
 * engram-app/Engram tests/crdt/test_crlf_frontmatter.py).
 *
 * CodeMirror holds every document with LF line breaks (EditorState splits on
 * \r\n and joins with \n), while the Y.Text keeps the note's own CRLF bytes.
 * Comparing the two directly read every CRLF note as drifted: the binding
 * re-adopted the doc into the editor every few seconds, Obsidian saved the
 * result, and a server-known note opened through the load gate went straight
 * to a conflict copy. Real Obsidian showed `drift on ... (editor 94 vs doc 100)`
 * looping and a `(conflict ...)` file on open.
 *
 * The editor is the real CM6 EditorState behind the minimal EditorView
 * stand-in the 2480 repro uses; live-binding.ts is the real code under test.
 */
import { afterEach, expect, test } from "bun:test";
import { EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import * as Y from "yjs";
import { FRONTMATTER_KEY, ORDER_KEY } from "../src/crdt/frontmatter-codec";
import { LiveBindingValue, setLiveBindingCoordinator } from "../src/crdt/live/live-binding";

const PATH = "Notes/Crlf.md";
const ID = "id-crlf";
const BODY = "\r\n# Heading\r\n\r\nline one\r\nline two\r\n";
const FENCE = "---\r\ntitle: T\r\nstatus: draft\r\n---\r\n";

function editorOver(initial: string) {
	let binding: LiveBindingValue | null = null;
	const dispatched: TransactionSpec[] = [];
	const ed: any = { composing: false };
	const info = { file: { path: PATH }, editor: { cm: ed } };
	let state = EditorState.create({ doc: initial });
	Object.defineProperty(ed, "state", {
		get: () =>
			new Proxy(state, {
				get: (t, k) => (k === "field" ? () => info : Reflect.get(t, k, t)),
			}),
	});
	ed.dispatch = (spec: TransactionSpec | Transaction) => {
		const tr =
			"startState" in spec ? (spec as Transaction) : state.update(spec as TransactionSpec);
		if (!("startState" in spec)) dispatched.push(spec as TransactionSpec);
		const startState = state;
		state = tr.state;
		binding?.update({
			docChanged: tr.docChanged,
			transactions: [tr],
			state,
			startState,
		} as any);
	};
	return { ed, dispatched, setBinding: (b: LiveBindingValue) => (binding = b) };
}

function bind(text: Y.Text, opts: { awaitsServer?: boolean; copies?: string[] } = {}) {
	setLiveBindingCoordinator({
		resolveId: () => ID,
		residentText: () => ({ text, ready: Promise.resolve() }),
		enroll: () => {},
		onBind: () => {},
		onRelease: () => {},
		awaitsServer: () => opts.awaitsServer === true,
		onLoadGateOpen: () => () => {},
		loadMergeBase: async () => null,
		keepConflictCopy: async (_p: string, t: string) => {
			opts.copies?.push(t);
			return true;
		},
		restoreLocalText: async () => {},
	});
}

const tick = () => new Promise((r) => setTimeout(r, 5));

afterEach(() => setLiveBindingCoordinator(null));

test("opening a CRLF note is a no-op: no doc ops, no editor repaint, no drift", async () => {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	text.insert(0, BODY);
	const updates: unknown[] = [];
	doc.on("update", (_u: Uint8Array, origin: unknown) => updates.push(origin));
	bind(text);
	// Obsidian loads the file's CRLF bytes; CodeMirror stores them as LF.
	const { ed, dispatched, setBinding } = editorOver(BODY);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await tick();

	(binding as any).runDriftCheck();
	expect(dispatched, "the editor was repainted (Obsidian then saves it)").toEqual([]);
	expect(updates, "opening minted CRDT ops").toEqual([]);
	expect(text.toJSON()).toBe(BODY);
	binding.destroy();
});

test("a server-known CRLF note through the load gate writes no conflict copy", async () => {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	const copies: string[] = [];
	bind(text, { awaitsServer: true, copies });
	const { ed, dispatched, setBinding } = editorOver(BODY);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await tick();

	const server = new Y.Doc();
	server.getText("content").insert(0, BODY);
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(server), "provider");
	await tick();
	await tick();

	expect(copies, "an identical note was kept as a conflict copy").toEqual([]);
	expect(dispatched).toEqual([]);
	expect(text.toJSON()).toBe(BODY);
	binding.destroy();
});

test("typing into a CRLF note lands at the right place and keeps CRLF", async () => {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	text.insert(0, BODY);
	bind(text);
	const { ed, setBinding } = editorOver(BODY);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await tick();

	const at = ed.state.doc.toString().indexOf("line two");
	ed.dispatch({ changes: { from: at, insert: "new line\n" } });
	expect(text.toJSON()).toBe("\r\n# Heading\r\n\r\nline one\r\nnew line\r\nline two\r\n");
	// Deleting a whole line break removes the CRLF pair, not half of it.
	const nl = ed.state.doc.toString().indexOf("\nline two");
	ed.dispatch({ changes: { from: nl, to: nl + 1 } });
	expect(text.toJSON()).toBe("\r\n# Heading\r\n\r\nline one\r\nnew lineline two\r\n");
	(binding as any).runDriftCheck();
	expect(ed.state.doc.toString()).toBe(text.toJSON().replace(/\r\n/g, "\n"));
	binding.destroy();
});

test("a remote edit to a CRLF note paints at the right place", async () => {
	const server = new Y.Doc();
	server.getText("content").insert(0, BODY);
	const doc = new Y.Doc();
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(server));
	const text = doc.getText("content");
	bind(text);
	const { ed, setBinding } = editorOver(BODY);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await tick();

	const st = server.getText("content");
	st.insert(st.toJSON().indexOf("line two"), "remote\r\n");
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(server, Y.encodeStateVector(doc)), "provider");
	expect(ed.state.doc.toString()).toBe("\n# Heading\n\nline one\nremote\nline two\n");
	binding.destroy();
});

test("opening an old-plugin-damaged note (fence in the body) heals it with one edit", async () => {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	text.insert(0, FENCE + BODY);
	let edits = 0;
	doc.on("update", () => edits++);
	bind(text);
	// The file on disk is the damaged doc's projection: the CRLF block plus body.
	const { ed, dispatched, setBinding } = editorOver(FENCE + BODY);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await tick();
	(binding as any).runDriftCheck();

	expect(doc.getArray(ORDER_KEY).toArray()).toEqual(["title", "status"]);
	expect(Object.keys(doc.getMap(FRONTMATTER_KEY).toJSON()).sort()).toEqual(["status", "title"]);
	expect(text.toJSON(), "the fence must leave the body, CRLF body intact").toBe(BODY);
	expect(edits, "the heal is ONE transaction").toBe(1);
	expect(dispatched, "the editor already shows the healed note").toEqual([]);
	binding.destroy();
});

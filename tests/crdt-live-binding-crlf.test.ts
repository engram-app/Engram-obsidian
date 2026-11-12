/**
 * A CRLF note opened in the editor (Engram-obsidian#697, e2e
 * engram-app/Engram tests/crdt/test_crlf_frontmatter.py).
 *
 * CodeMirror holds every document with LF breaks. A doc that kept the note's
 * CRLF read as drifted on every check: the binding re-adopted the doc into the
 * editor every few seconds, Obsidian saved the result, and a server-known
 * note opened through the load gate went straight to a conflict copy (real
 * Obsidian: `drift on ... (editor 94 vs doc 100)` looping, a `(conflict ...)`
 * file on open). Docs now hold LF only (line-endings.ts); these pin the open
 * of a new LF doc, and the one-time heal of a doc from before that.
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
const LF_BODY = BODY.replace(/\r\n/g, "\n");
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

function bind(
	text: Y.Text,
	opts: { awaitsServer?: boolean; copies?: string[]; base?: string | null } = {},
) {
	setLiveBindingCoordinator({
		resolveId: () => ID,
		residentText: () => ({ text, ready: Promise.resolve() }),
		enroll: () => {},
		onBind: () => {},
		onRelease: () => {},
		awaitsServer: () => opts.awaitsServer === true,
		onLoadGateOpen: () => () => {},
		loadMergeBase: async () => opts.base ?? null,
		keepConflictCopy: async (_p: string, t: string) => {
			opts.copies?.push(t);
			return true;
		},
		restoreLocalText: async () => {},
	});
}

const tick = () => new Promise((r) => setTimeout(r, 5));

afterEach(() => setLiveBindingCoordinator(null));

test("opening a CRLF file over its LF doc is a no-op: no ops, no repaint, no drift", async () => {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	text.insert(0, LF_BODY);
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
	binding.destroy();
});

test("opening a doc from before LF-only heals it once, with no repaint", async () => {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	text.insert(0, BODY);
	let edits = 0;
	doc.on("update", () => edits++);
	bind(text);
	const { ed, dispatched, setBinding } = editorOver(BODY);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await tick();
	(binding as any).runDriftCheck();

	expect(text.toJSON()).toBe(LF_BODY);
	expect(edits, "the heal is ONE transaction").toBe(1);
	expect(dispatched).toEqual([]);
	binding.destroy();
});

test("a server-known CRLF note through the load gate writes no conflict copy", async () => {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	const copies: string[] = [];
	bind(text, { awaitsServer: true, copies, base: BODY });
	const { ed, dispatched, setBinding } = editorOver(BODY);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await tick();

	const server = new Y.Doc();
	server.getText("content").insert(0, LF_BODY);
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(server), "provider");
	await tick();
	await tick();

	expect(copies, "an identical note was kept as a conflict copy").toEqual([]);
	expect(dispatched).toEqual([]);
	expect(text.toJSON()).toBe(LF_BODY);
	binding.destroy();
});

test("the load gate merges typed edits over a CRLF merge base", async () => {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	const copies: string[] = [];
	// The base is the CRLF file as last synced; the server moved on since.
	bind(text, { awaitsServer: true, copies, base: BODY });
	const { ed, setBinding } = editorOver(BODY);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await tick();
	ed.dispatch({ changes: { from: 0, insert: "typed\n" }, userEvent: "input" });

	const server = new Y.Doc();
	server.getText("content").insert(0, `${LF_BODY}remote\n`);
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(server), "provider");
	await tick();
	await tick();

	expect(copies, "a clean three-way merge was kept as a conflict copy").toEqual([]);
	expect(text.toJSON()).toBe(`typed\n${LF_BODY}remote\n`);
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
	expect(text.toJSON(), "the fence must leave the body, body in LF").toBe(LF_BODY);
	expect(edits, "the heal is ONE transaction").toBe(1);
	expect(dispatched, "the editor already shows the healed note").toEqual([]);
	binding.destroy();
});

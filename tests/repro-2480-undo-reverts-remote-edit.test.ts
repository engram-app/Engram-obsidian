/**
 * Engram#2480 repro, mechanism A (Obsidian undo). RED on main by design.
 *
 * An MCP `edit_note` lands on the server, reaches this device as a CRDT update,
 * and live-binding paints it into the open editor. The paint carries only
 * ySyncAnnotation (no `Transaction.addToHistory.of(false)`), so CM6 history
 * records it. The user then presses Ctrl+Z: CM6 dispatches the inverse with no
 * ySyncAnnotation, `update()` forwards it to the Y.Text as a local edit, and the
 * outbound update reverts the MCP section on the server.
 *
 * The editor is a minimal EditorView stand-in over a REAL CM6 EditorState with
 * the stock `history()` extension (what Obsidian's editor runs), so undo is the
 * real `@codemirror/commands` undo. live-binding.ts is the real code under test.
 */
import { afterEach, expect, test } from "bun:test";
import { history, isolateHistory, undo } from "@codemirror/commands";
import { EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import * as Y from "yjs";
import { LiveBindingValue, setLiveBindingCoordinator } from "../src/crdt/live/live-binding";

const PATH = "Notes/Plan.md";
const ID = "id-plan";
const OLD = "# Note\n\n## Plan\nold section\n\n## Other\nkeep me\n";
const NEW = "# Note\n\n## Plan\nnew section from MCP\n\n## Other\nkeep me\n";

/** Enough of EditorView for live-binding: state, dispatch -> update(), composing. */
function realStateEditor(initial: string) {
	let binding: LiveBindingValue | null = null;
	const ed: any = { composing: false };
	const info = { file: { path: PATH }, editor: { cm: ed } };
	let state = EditorState.create({ doc: initial, extensions: [history()] });
	const wrap = (s: EditorState) =>
		new Proxy(s, {
			get: (t, k) => (k === "field" ? () => info : Reflect.get(t, k, t)),
		});
	Object.defineProperty(ed, "state", { get: () => wrap(state) });
	ed.realState = () => state;
	ed.dispatch = (spec: TransactionSpec | Transaction) => {
		const tr =
			"startState" in spec ? (spec as Transaction) : state.update(spec as TransactionSpec);
		const startState = state;
		state = tr.state;
		binding?.update({
			docChanged: tr.docChanged,
			transactions: [tr],
			state,
			startState,
		} as any);
	};
	return { ed, setBinding: (b: LiveBindingValue) => (binding = b) };
}

afterEach(() => setLiveBindingCoordinator(null));

test("repro 2480 A: Ctrl+Z after a remote MCP edit must not revert it on the server", async () => {
	// Server and device share one lineage holding OLD.
	const server = new Y.Doc();
	server.getText("content").insert(0, OLD);
	const local = new Y.Doc();
	Y.applyUpdate(local, Y.encodeStateAsUpdate(server));
	const text = local.getText("content");

	setLiveBindingCoordinator({
		resolveId: () => ID,
		residentText: () => ({ text, ready: Promise.resolve() }),
		enroll: () => {},
		onBind: () => {},
		onRelease: () => {},
		awaitsServer: () => false,
		onLoadGateOpen: () => () => {},
		loadMergeBase: async () => null,
		keepConflictCopy: async () => true,
		restoreLocalText: async () => {},
	});
	const { ed, setBinding } = realStateEditor(OLD);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await new Promise((r) => setTimeout(r, 5)); // ready -> reconcile noop -> live

	// Outbound wire: what the provider would send for binding-origin edits.
	const outbound: Uint8Array[] = [];
	local.on("update", (u: Uint8Array, origin: unknown) => {
		if (origin === binding) outbound.push(u);
	});

	// MCP edit_note replace_section commits on the server; the room/fanout
	// delivers the delta to this device (remote origin, not the binding).
	const st = server.getText("content");
	const at = OLD.indexOf("old section");
	server.transact(() => {
		st.delete(at, "old section".length);
		st.insert(at, "new section from MCP");
	});
	Y.applyUpdate(local, Y.encodeStateAsUpdate(server, Y.encodeStateVector(local)), "provider");
	expect(ed.state.doc.toString()).toBe(NEW); // painted into the editor

	// User presses Ctrl+Z (Obsidian's undo is CM6 history undo).
	undo({ state: ed.realState(), dispatch: ed.dispatch });

	// Ship whatever the binding forwarded to the server.
	for (const u of outbound) Y.applyUpdate(server, u, "client");
	const serverText = server.getText("content").toJSON();
	expect(
		serverText,
		`undo reverted the MCP section on the server (outbound updates: ${outbound.length}); server now holds "${serverText.includes("old section") ? "old section" : "?"}"`,
	).toBe(NEW);
	binding.destroy();
});

test("2480 A edge: the user's own edit stays undoable, and its undo keeps the remote edit", async () => {
	const server = new Y.Doc();
	server.getText("content").insert(0, OLD);
	const local = new Y.Doc();
	Y.applyUpdate(local, Y.encodeStateAsUpdate(server));
	const text = local.getText("content");
	setLiveBindingCoordinator({
		resolveId: () => ID,
		residentText: () => ({ text, ready: Promise.resolve() }),
		enroll: () => {},
		onBind: () => {},
		onRelease: () => {},
		awaitsServer: () => false,
		onLoadGateOpen: () => () => {},
		loadMergeBase: async () => null,
		keepConflictCopy: async () => true,
		restoreLocalText: async () => {},
	});
	const { ed, setBinding } = realStateEditor(OLD);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await new Promise((r) => setTimeout(r, 5));

	// The user types at the top, then the MCP edit lands below it.
	ed.dispatch({ changes: { from: 0, insert: "typed\n" } });
	const st = server.getText("content");
	Y.applyUpdate(server, Y.encodeStateAsUpdate(local, Y.encodeStateVector(server)));
	const at = st.toJSON().indexOf("old section");
	server.transact(() => {
		st.delete(at, "old section".length);
		st.insert(at, "new section from MCP");
	});
	Y.applyUpdate(local, Y.encodeStateAsUpdate(server, Y.encodeStateVector(local)), "provider");
	expect(ed.state.doc.toString()).toBe(`typed\n${NEW}`);

	// Undo removes only the user's line; the remote section survives in both.
	undo({ state: ed.realState(), dispatch: ed.dispatch });
	expect(ed.state.doc.toString()).toBe(NEW);
	expect(text.toJSON()).toBe(NEW);
	binding.destroy();
});

test("2480 A edge: a drift repair pushes typing the doc missed to the doc, never erases it", async () => {
	const local = new Y.Doc();
	local.getText("content").insert(0, OLD);
	const text = local.getText("content");
	setLiveBindingCoordinator({
		resolveId: () => ID,
		residentText: () => ({ text, ready: Promise.resolve() }),
		enroll: () => {},
		onBind: () => {},
		onRelease: () => {},
		awaitsServer: () => false,
		onLoadGateOpen: () => () => {},
		loadMergeBase: async () => null,
		keepConflictCopy: async () => true,
		restoreLocalText: async () => {},
	});
	const { ed, setBinding } = realStateEditor(OLD);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await new Promise((r) => setTimeout(r, 5));

	// The user's keystroke reaches the editor, but its forward is dropped.
	const typed = `${OLD}typed\n`;
	setBinding(null as unknown as LiveBindingValue);
	// Isolated: the real drift check runs 3 s later, past CM6's grouping delay.
	ed.dispatch({
		changes: { from: OLD.length, insert: "typed\n" },
		annotations: isolateHistory.of("after"),
	});
	setBinding(binding);
	(binding as unknown as { runDriftCheck(): void }).runDriftCheck();
	// Review finding 5, under the delta review's rule: the typing stays in
	// the editor and is forwarded to the doc, not deleted.
	expect(ed.state.doc.toString()).toBe(typed);
	expect(text.toJSON()).toBe(typed);

	// It is still the user's own undoable edit, and its undo is forwarded.
	undo({ state: ed.realState(), dispatch: ed.dispatch });
	expect(ed.state.doc.toString()).toBe(OLD);
	expect(text.toJSON()).toBe(OLD);
	binding.destroy();
});

test("D5 drift: undoing a drift repair that adopted a dropped REMOTE paint deletes the remote edit", async () => {
	const local = new Y.Doc();
	local.getText("content").insert(0, OLD);
	const text = local.getText("content");
	setLiveBindingCoordinator({
		resolveId: () => ID,
		residentText: () => ({ text, ready: Promise.resolve() }),
		enroll: () => {},
		onBind: () => {},
		onRelease: () => {},
		awaitsServer: () => false,
		onLoadGateOpen: () => () => {},
		loadMergeBase: async () => null,
		keepConflictCopy: async () => true,
		restoreLocalText: async () => {},
	});
	const { ed, setBinding } = realStateEditor(OLD);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await new Promise((r) => setTimeout(r, 5));
	// A remote edit lands in the doc but its paint is dropped (the drift case).
	const at = OLD.indexOf("old section");
	local.transact(() => {
		text.delete(at, "old section".length);
		text.insert(at, "new section from MCP");
	}, binding);
	expect(ed.state.doc.toString()).toBe(OLD);
	(binding as unknown as { runDriftCheck(): void }).runDriftCheck();
	expect(ed.state.doc.toString()).toBe(NEW); // repaired toward the doc
	undo({ state: ed.realState(), dispatch: ed.dispatch }); // user presses Ctrl+Z once
	expect(text.toJSON()).toBe(NEW); // the remote edit must survive in the doc
	binding.destroy();
});

test("2480 A edge: an ambiguous drift keeps the editor's text as a conflict copy, then takes the doc", async () => {
	const local = new Y.Doc();
	local.getText("content").insert(0, OLD);
	const text = local.getText("content");
	const copies: string[] = [];
	setLiveBindingCoordinator({
		resolveId: () => ID,
		residentText: () => ({ text, ready: Promise.resolve() }),
		enroll: () => {},
		onBind: () => {},
		onRelease: () => {},
		awaitsServer: () => false,
		onLoadGateOpen: () => () => {},
		loadMergeBase: async () => null,
		keepConflictCopy: async (_p: string, t: string) => {
			copies.push(t);
			return true;
		},
		restoreLocalText: async () => {},
	});
	const { ed, setBinding } = realStateEditor(OLD);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await new Promise((r) => setTimeout(r, 5));
	// Both sides rewrote the same words, each change dropped on the other side.
	setBinding(null as unknown as LiveBindingValue);
	const at = OLD.indexOf("old section");
	ed.dispatch({ changes: { from: at, to: at + "old section".length, insert: "typed text" } });
	setBinding(binding);
	local.transact(() => {
		text.delete(at, "old section".length);
		text.insert(at, "new section from MCP");
	}, binding);
	(binding as unknown as { runDriftCheck(): void }).runDriftCheck();
	await new Promise((r) => setTimeout(r, 5));
	expect(copies).toEqual([OLD.replace("old section", "typed text")]);
	expect(ed.state.doc.toString()).toBe(NEW);
	expect(text.toJSON()).toBe(NEW);
	binding.destroy();
});

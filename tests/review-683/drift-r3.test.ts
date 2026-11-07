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
import { history } from "@codemirror/commands";
import { EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import * as Y from "yjs";
import { LiveBindingValue, setLiveBindingCoordinator } from "../../src/crdt/live/live-binding";

const PATH = "Notes/Plan.md";
const ID = "id-plan";
const _OLD = "# Note\n\n## Plan\nold section\n\n## Other\nkeep me\n";
const _NEW = "# Note\n\n## Plan\nnew section from MCP\n\n## Other\nkeep me\n";

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

test("r3 N4: drift repair from a 3 s old `agreed` duplicates the line the user just typed", async () => {
	const start = "- a\n- b\n";
	const local = new Y.Doc();
	const text = local.getText("content");
	text.insert(0, start);
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
	} as any);
	const { ed, setBinding } = realStateEditor(start);
	const binding = new LiveBindingValue(ed);
	setBinding(binding);
	await new Promise((r) => setTimeout(r, 5)); // agreed = "- a\n- b\n"
	// Within the next 3 s the user types a list item; it forwards normally.
	ed.dispatch({ changes: { from: start.length, insert: "- x\n" } });
	expect(text.toJSON()).toBe("- a\n- b\n- x\n");
	// A remote delete of "- b" lands in the doc but its paint is dropped.
	const at = text.toJSON().indexOf("- b\n");
	local.transact(() => text.delete(at, 4), binding);
	expect(ed.state.doc.toString()).toBe("- a\n- b\n- x\n");
	(binding as unknown as { runDriftCheck(): void }).runDriftCheck();
	await new Promise((r) => setTimeout(r, 5));
	// Right answer: the doc's text ("- a\n- x\n"). merge3 from the stale base gives "- a\n- x\n- x\n".
	expect(text.toJSON()).toBe("- a\n- x\n");
	expect(ed.state.doc.toString()).toBe("- a\n- x\n");
	binding.destroy();
});

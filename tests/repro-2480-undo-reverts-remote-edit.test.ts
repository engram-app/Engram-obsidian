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
import { history, undo } from "@codemirror/commands";
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

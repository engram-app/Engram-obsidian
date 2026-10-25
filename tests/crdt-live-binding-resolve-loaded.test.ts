/**
 * The open editor's half of the load gate (`LiveBindingValue.resolveLoaded`),
 * driven with a small fake editor: `state.doc`, `state.field` and `dispatch`
 * are all the binding touches. The note is server-known with an empty doc, so
 * the binding defers (keystrokes queue in the editor) until the server state
 * lands, then resolves once.
 */
import { afterEach, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { LiveBindingValue, setLiveBindingCoordinator } from "../src/crdt/live/live-binding";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { MESSAGE_SYNC, toB64 } from "../src/crdt/wire";

const PATH = "Notes/Held.md";
const ID = "id-held";
const BASE = "# held\n\nfirst line.\n";

function applyCm(before: string, changes: Array<{ from: number; to: number; insert: string }>) {
	let out = before;
	let adj = 0;
	for (const c of changes) {
		out = out.slice(0, c.from + adj) + c.insert + out.slice(c.to + adj);
		adj += c.insert.length - (c.to - c.from);
	}
	return out;
}

function fakeEditor(initial: string) {
	const ed: any = { text: initial, composing: false, userDispatches: 0 };
	const info = { file: { path: PATH }, editor: { cm: ed } };
	ed.state = { doc: { toString: () => ed.text }, field: () => info };
	ed.dispatch = (spec: any) => {
		if (spec.changes) ed.text = applyCm(ed.text, spec.changes);
		if (!spec.annotations) ed.userDispatches += 1;
	};
	return ed;
}

function setup(opts: {
	editor: string;
	base: string | null;
	copyOk?: boolean;
	/** The copy write settles only when this resolves. */
	copyGate?: Promise<void>;
}) {
	const doc = new Y.Doc();
	const text = doc.getText("content");
	const calls = { copies: [] as string[], restored: [] as string[] };
	let gateOpen: (() => void) | null = null;
	setLiveBindingCoordinator({
		resolveId: () => ID,
		residentText: () => ({ text, ready: Promise.resolve() }),
		enroll: () => {},
		onBind: () => {},
		onRelease: () => {},
		awaitsServer: () => text.length === 0,
		onLoadGateOpen: (_id, cb) => {
			gateOpen = cb;
			return () => {
				gateOpen = null;
			};
		},
		loadMergeBase: async () => opts.base,
		keepConflictCopy: async (_p, t) => {
			calls.copies.push(t);
			if (opts.copyGate) await opts.copyGate;
			return opts.copyOk ?? true;
		},
		restoreLocalText: async (_p, t) => {
			calls.restored.push(t);
		},
	});
	const ed = fakeEditor(opts.editor);
	const binding = new LiveBindingValue(ed);
	/** The server's state arriving (room STEP2 or crdt_doc_state). */
	const serverLoads = (server: string) => {
		const s = new Y.Doc();
		s.getText("content").insert(0, server);
		Y.applyUpdate(doc, Y.encodeStateAsUpdate(s));
	};
	return { doc, text, ed, binding, calls, serverLoads, openGate: () => gateOpen?.() };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

afterEach(() => setLiveBindingCoordinator(null));

test("keystrokes queued before the load land once, on the server lineage", async () => {
	const typed = `${BASE}typed while loading.\n`;
	const { text, ed, binding, serverLoads } = setup({ editor: typed, base: BASE });
	await tick();
	expect(text.toJSON()).toBe(""); // held: nothing forwarded yet
	serverLoads(BASE);
	await tick();
	expect(text.toJSON()).toBe(typed);
	expect(ed.text).toBe(typed);
	binding.destroy();
});

test("server moved: the queued edit and the server's edit both survive", async () => {
	const { text, ed, binding, serverLoads } = setup({ editor: `${BASE}mine.\n`, base: BASE });
	await tick();
	serverLoads(`THEIRS\n${BASE}`);
	await tick();
	expect(text.toJSON()).toBe(`THEIRS\n${BASE}mine.\n`);
	expect(ed.text).toBe(`THEIRS\n${BASE}mine.\n`);
	binding.destroy();
});

test("conflict: one copy of the editor's text, the note takes the server's", async () => {
	const mine = BASE.replace("first", "MINE");
	const theirs = BASE.replace("first", "THEIR");
	const { text, ed, binding, calls, serverLoads } = setup({ editor: mine, base: BASE });
	await tick();
	serverLoads(theirs);
	await tick();
	expect(calls.copies).toEqual([mine]);
	expect(ed.text).toBe(theirs);
	expect(text.toJSON()).toBe(theirs);
	binding.destroy();
});

test("conflict copy fails, editor open: its text is merged back as an edit", async () => {
	const mine = BASE.replace("first", "MINE");
	const { ed, binding, serverLoads } = setup({ editor: mine, base: BASE, copyOk: false });
	await tick();
	serverLoads(BASE.replace("first", "THEIR"));
	await tick();
	expect(ed.text).toBe(mine);
	expect(ed.userDispatches).toBe(1); // a user-origin edit: forwarded and synced
	binding.destroy();
});

test("conflict copy fails after the editor closed: the text is written back to disk", async () => {
	const mine = BASE.replace("first", "MINE");
	let release!: () => void;
	const copyGate = new Promise<void>((r) => (release = r));
	const { binding, calls, serverLoads } = setup({
		editor: mine,
		base: null,
		copyOk: false,
		copyGate,
	});
	await tick();
	serverLoads(BASE);
	await tick();
	expect(calls.copies).toEqual([mine]); // decided: conflict, copy in flight
	binding.destroy(); // the editor closes before the copy write fails
	release();
	await tick();
	expect(calls.restored).toEqual([mine]);
});

test("server state with no data: the gate opens and the editor seeds the doc", async () => {
	const typed = `${BASE}typed.\n`;
	const { text, binding, openGate } = setup({ editor: typed, base: null });
	await tick();
	openGate();
	expect(text.toJSON()).toBe(typed);
	binding.destroy();
});

test("empty server note, editor open: the room's empty STEP2 opens the gate, the editor seeds", async () => {
	// The production trigger, not a hand-fired gate: a real registry, the open
	// editor's room handshake answering with a server doc that holds nothing.
	const mgr = new ProviderRegistry({
		dbPrefix: "resolve-empty-step2",
		send: () => true,
		onFlushToDisk: () => undefined,
		serverHolds: () => true,
	});
	const typed = `${BASE}typed into an empty server note.\n`;
	setLiveBindingCoordinator({
		resolveId: () => ID,
		residentText: (id) => mgr.residentText(id),
		enroll: () => {},
		onBind: () => {},
		onRelease: () => {},
		awaitsServer: (id) => mgr.awaitsServerState(id),
		onLoadGateOpen: (id, cb) => mgr.onLoadGateOpen(id, cb),
		loadMergeBase: async () => null,
		keepConflictCopy: async () => true,
		restoreLocalText: async () => {},
	});
	const binding = new LiveBindingValue(fakeEditor(typed));
	await tick();
	expect(mgr.awaitsServerState(ID)).toBe(true); // held, deferred
	const enc = encoding.createEncoder();
	encoding.writeVarUint(enc, MESSAGE_SYNC);
	syncProtocol.writeSyncStep2(enc, new Y.Doc());
	await mgr.receive(ID, toB64(encoding.toUint8Array(enc)));
	await tick();
	expect(mgr.awaitsServerState(ID)).toBe(false);
	expect(await mgr.getText(ID)).toBe(typed);
	binding.destroy();
	await mgr.destroyAll();
});

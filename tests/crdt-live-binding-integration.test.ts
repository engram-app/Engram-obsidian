// Drives the real LiveBindingValue through the #544 sequences (r6 go-live). No DOM:
// a fake view applies real CM6 transactions and feeds each one back to the
// binding as a ViewUpdate, the way CodeMirror does.
import { afterEach, describe, expect, it } from "bun:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import * as Y from "yjs";
import {
	type LiveBindingCoordinator,
	LiveBindingValue,
	setLiveBindingCoordinator,
} from "../src/crdt/live/live-binding";

const PATH = "note.md";

class FakeView {
	state: EditorState;
	composing = false;
	binding: LiveBindingValue | null = null;

	constructor(text: string) {
		const info = { file: { path: PATH }, editor: { cm: this } };
		this.state = EditorState.create({
			doc: text,
			extensions: [editorInfoField.init(() => info as never)],
		});
	}

	dispatch(spec: TransactionSpec): void {
		const startState = this.state;
		const tr = startState.update(spec);
		this.state = tr.state;
		this.binding?.update({
			docChanged: tr.docChanged,
			transactions: [tr],
			startState,
			state: tr.state,
		} as unknown as ViewUpdate);
	}

	/** A user keystroke inserting `text` at `pos` (end of doc by default). */
	type(text: string, pos = this.state.doc.length): void {
		this.dispatch({ changes: { from: pos, insert: text }, userEvent: "input.type" });
	}

	/** Obsidian's pane mirror / reload: a whole-buffer "set" (CDP-verified). */
	set(text: string): void {
		this.dispatch({
			changes: { from: 0, to: this.state.doc.length, insert: text },
			userEvent: "set",
		});
	}

	/** A click: a selection-only update, no doc change. */
	click(): void {
		this.dispatch({ selection: { anchor: 0 }, userEvent: "select.pointer" });
	}

	get text(): string {
		return this.state.doc.toString();
	}
}

interface Room {
	text: Y.Text;
	ready: Promise<void>;
	open: () => void;
}

function room(content: string): Room {
	const text = new Y.Doc().getText("body");
	if (content) text.insert(0, content);
	let open = () => {};
	const ready = new Promise<void>((r) => {
		open = r;
	});
	return { text, ready, open };
}

class FakeCoordinator implements LiveBindingCoordinator {
	id = "X";
	lca: string | null;
	readonly diskLog: Array<{ text: string; at: number }> = [];
	readonly conflicts: string[] = [];
	readonly rooms = new Map<string, Room>();

	constructor(lca: string | null) {
		this.lca = lca;
	}
	resolveId(): string {
		return this.id;
	}
	residentText(noteId: string): { text: Y.Text; ready: Promise<void> } {
		const r = this.rooms.get(noteId);
		if (!r) throw new Error(`no room ${noteId}`);
		return r;
	}
	enroll(): void {}
	onBind(): void {}
	onRelease(): void {}
	lcaFor(): string | null {
		return this.lca;
	}
	latestDiskSince(_path: string, since: number): string | null {
		const hits = this.diskLog.filter((d) => d.at >= since);
		return hits.length > 0 ? (hits[hits.length - 1]?.text ?? null) : null;
	}
	onConflict(_path: string, editorText: string): void {
		this.conflicts.push(editorText);
	}
	/** Obsidian autosaves the editor (the doc of an open note never takes it). */
	autosave(view: FakeView): void {
		this.diskLog.push({ text: view.text, at: Date.now() });
	}
}

/** Let the ready promise chains and deferred repaints run. */
const settle = () => new Promise((r) => setTimeout(r, 5));

let live: LiveBindingValue | null = null;
afterEach(() => {
	live?.destroy(); // clears the drift timer
	live = null;
	setLiveBindingCoordinator(null);
});

function bind(view: FakeView, coord: FakeCoordinator): void {
	setLiveBindingCoordinator(coord);
	live = new LiveBindingValue(view as never);
	view.binding = live;
}

const P = "alpha\nbravo\ncharlie\n";
const S = "ALPHA-S\nbravo\ncharlie\n";

/** Type `s` one keystroke at a time at `pos`. */
function typeAt(view: FakeView, pos: number, s: string): void {
	for (const [i, ch] of [...s].entries()) view.type(ch, pos + i);
}

describe("live binding go-live (#544, r6)", () => {
	it("autosave while entering, then more typing: once (Relay doubled this)", async () => {
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room(P);
		coord.rooms.set("X", x);
		bind(view, coord);

		typeAt(view, "alpha\nbravo".length, "TTT");
		coord.autosave(view);
		typeAt(view, view.text.length - 1, "UUU");
		x.open();
		await settle();

		const want = "alpha\nbravoTTT\ncharlieUUU\n";
		expect(view.text).toBe(want);
		expect(x.text.toJSON()).toBe(want);
	});

	it("same with a remote edit while entering: remote kept, typing once in place", async () => {
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room(P);
		coord.rooms.set("X", x);
		bind(view, coord);

		typeAt(view, "alpha\nbravo".length, "TTT");
		coord.autosave(view);
		typeAt(view, view.text.length - 1, "UUU");
		x.text.delete(0, "alpha".length);
		x.text.insert(0, "ALPHA-S");
		x.open();
		await settle();

		const want = "ALPHA-S\nbravoTTT\ncharlieUUU\n";
		expect(view.text).toBe(want);
		expect(x.text.toJSON()).toBe(want);
	});

	it("unsaved typing onto a doc that moved: rebased", async () => {
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room(S);
		coord.rooms.set("X", x);
		bind(view, coord);

		typeAt(view, P.length, "new\n");
		x.open();
		await settle();

		expect(view.text).toBe(`${S}new\n`);
		expect(x.text.toJSON()).toBe(`${S}new\n`);
	});

	it("no typing: the editor adopts the doc", async () => {
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room(S);
		coord.rooms.set("X", x);
		bind(view, coord);
		x.open();
		await settle();
		expect(view.text).toBe(S);
	});

	it("same-line conflict: doc wins in the editor, editor text goes to a conflict copy", async () => {
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room("alpha\nbravo REMOTE\ncharlie\n");
		coord.rooms.set("X", x);
		bind(view, coord);

		typeAt(view, "alpha\nbravo".length, " MINE");
		const typed = view.text;
		x.open();
		await settle();

		expect(view.text).toBe("alpha\nbravo REMOTE\ncharlie\n");
		expect(coord.conflicts).toEqual([typed]);
	});

	it("click-triggered re-attach keeps typing from the entering window", async () => {
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		coord.rooms.set("X", room("")); // wrong-mint doc, never opens
		const y = room(P);
		coord.rooms.set("Y", y);
		bind(view, coord);

		view.type("typed\n");
		coord.id = "Y";
		view.click();
		y.open();
		await settle();

		expect(view.text).toBe(`${P}typed\n`);
		expect(y.text.toJSON()).toBe(`${P}typed\n`);
	});

	it("a LIVE binding re-attaching to a doc that already holds its text applies nothing twice", async () => {
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room(P);
		coord.rooms.set("X", x);
		bind(view, coord);
		x.open();
		await settle();

		view.type("typed\n");
		expect(x.text.toJSON()).toBe(`${P}typed\n`);
		coord.lca = `${P}typed\n`; // saved and agreed
		const y = room(`${P}typed\n`);
		coord.rooms.set("Y", y);
		coord.id = "Y";
		view.click();
		y.open();
		await settle();

		expect(view.text).toBe(`${P}typed\n`);
		expect(y.text.toJSON()).toBe(`${P}typed\n`);
	});

	it("switching away and back before the doc loads goes live once", async () => {
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room(P);
		coord.rooms.set("X", x);
		coord.rooms.set("Y", room(""));
		bind(view, coord);

		coord.id = "Y";
		view.click();
		coord.id = "X";
		view.click();
		x.open();
		await settle();

		x.text.doc?.transact(() => x.text.insert(0, "R"), "remote");
		expect(view.text).toBe(`R${P}`);
	});
});

describe("live binding tracking: Obsidian set transactions", () => {
	async function liveOn(content: string) {
		const view = new FakeView(content);
		const coord = new FakeCoordinator(content);
		const x = room(content);
		coord.rooms.set("X", x);
		bind(view, coord);
		x.open();
		await settle();
		return { view, x };
	}

	it("a set equal to the doc is a no-op (sibling echo)", async () => {
		const { view, x } = await liveOn(P);
		view.type("Q", 0);
		view.set(`Q${P}`);
		expect(x.text.toJSON()).toBe(`Q${P}`);
	});

	it("a set with new text (external modify reload) is forwarded as a diff", async () => {
		const { view, x } = await liveOn(P);
		view.set(`${P}EXT\n`);
		expect(x.text.toJSON()).toBe(`${P}EXT\n`);
	});

	it("a stale set echo after a remote edit does not revert it (Relay reverted this)", async () => {
		const { view, x } = await liveOn(P);
		x.text.doc?.transact(() => x.text.insert(0, "R"), "remote"); // painted into the editor
		expect(view.text).toBe(`R${P}`);
		view.set(P); // a sibling pane's mirror of the pre-remote text arrives late
		expect(x.text.toJSON()).toBe(`R${P}`);
		await settle();
		expect(view.text).toBe(`R${P}`);
	});
});

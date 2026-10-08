// Drives the real LiveBindingValue through the #544 stale-merge-base bugs. No DOM:
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
	disk: string;
	readonly rooms = new Map<string, Room>();

	constructor(disk: string) {
		this.disk = disk;
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
	/** When set, readDisk waits on it: holds the read in flight. */
	gate: Promise<void> | null = null;
	async readDisk(): Promise<string | null> {
		if (this.gate) await this.gate;
		return this.disk;
	}
}

/** Let the ready / readDisk promise chains run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

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

describe("live binding #544: stale merge base after an autosave", () => {
	it("does not double typing the doc already got from the autosave", async () => {
		const P = "alpha\nbravo\ncharlie\n";
		const saved = "alpha\nbravo\nTYPED\ncharlie\n";
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room("");
		coord.rooms.set("X", x);
		bind(view, coord);

		view.type("TYPED\n", "alpha\nbravo\n".length);
		coord.disk = saved; // Obsidian autosaves
		x.text.insert(0, saved); // the doc is seeded from that disk
		view.type("more\n");
		x.open();
		await settle();

		expect(view.text).toBe(`${saved}more\n`);
		expect(x.text.toJSON()).toBe(`${saved}more\n`);
	});

	it("keeps a remote edit the doc gained on top of the autosave", async () => {
		const P = "line one\nline two\n";
		const S = "line one REMOTE\nline two\n";
		const T = "typed line\n";
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room("");
		coord.rooms.set("X", x);
		bind(view, coord);

		view.type(T);
		coord.disk = P + T;
		x.text.insert(0, S + T); // server merged its edit with the saved disk
		x.open();
		await settle();

		expect(view.text).toBe(S + T);
		expect(x.text.toJSON()).toBe(S + T);
	});

	it("keeps defer-window typing when a click triggers the re-attach", async () => {
		const P = "loaded\n";
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		coord.rooms.set("X", room("")); // wrong-mint doc, never opens
		const y = room(P);
		coord.rooms.set("Y", y);
		bind(view, coord);

		view.type("typed\n");
		coord.id = "Y"; // genesis adopt remaps the path under the open editor
		view.click();
		y.open();
		await settle();

		expect(view.text).toBe(`${P}typed\n`);
		expect(y.text.toJSON()).toBe(`${P}typed\n`);
	});

	it("a LIVE binding re-attaching to a doc that already holds its text applies nothing twice", async () => {
		const P = "loaded\n";
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room(P);
		coord.rooms.set("X", x);
		bind(view, coord);
		x.open();
		await settle();

		view.type("typed\n"); // live: forwarded into X
		expect(x.text.toJSON()).toBe(`${P}typed\n`);
		const y = room(`${P}typed\n`); // the adopt transferred X's content
		coord.rooms.set("Y", y);
		coord.id = "Y";
		view.click();
		y.open();
		await settle();

		expect(view.text).toBe(`${P}typed\n`);
		expect(y.text.toJSON()).toBe(`${P}typed\n`);
	});

	it("keeps typing saved before the server seed of an existing note", async () => {
		const P = "line one\nline two\n";
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room("");
		coord.rooms.set("X", x);
		bind(view, coord);

		view.type("T\n");
		coord.disk = `${P}T\n`; // autosave; a bound note's save never reaches the doc
		view.type("U\n");
		x.text.insert(0, P); // the server seeds the ORIGINAL content
		x.open();
		await settle();

		expect(view.text).toBe(`${P}T\nU\n`);
		expect(x.text.toJSON()).toBe(`${P}T\nU\n`);
	});

	it("a disk read outlived by a newer attach does not go live twice", async () => {
		const P = "loaded\n";
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room(P);
		coord.rooms.set("X", x);
		coord.rooms.set("Y", room(""));
		let release = () => {};
		coord.gate = new Promise<void>((r) => {
			release = r;
		});
		bind(view, coord);

		view.type("typed\n"); // dirty -> the reconcile reads disk first
		x.open();
		await settle(); // read #1 in flight
		coord.id = "Y";
		view.click(); // away
		coord.id = "X";
		view.click(); // back: same resident X, carried dirty -> read #2 in flight
		await settle();
		release();
		await settle();

		x.text.doc?.transact(() => x.text.insert(0, "R"), "remote");
		expect(view.text).toBe(`R${P}typed\n`);
	});

	it("switching away and back before the doc loads goes live once", async () => {
		const P = "loaded\n";
		const view = new FakeView(P);
		const coord = new FakeCoordinator(P);
		const x = room(P);
		coord.rooms.set("X", x);
		coord.rooms.set("Y", room(""));
		bind(view, coord);

		coord.id = "Y";
		view.click(); // away
		coord.id = "X";
		view.click(); // back: both X attaches wait on the same ready
		x.open();
		await settle();

		x.text.doc?.transact(() => x.text.insert(0, "R"), "remote");
		expect(view.text).toBe(`R${P}`);
	});
});

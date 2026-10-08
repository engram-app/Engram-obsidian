// Probe harness driving Relay's real MergeHSM + real replayBufferedEdits.
// The HSMEditorPlugin buffering logic is emulated line-for-line (cited) because
// it needs a live CM6 EditorView + Obsidian; the HSM and rebase are the real code.
import * as Y from "yjs";
const R = "/home/open-claw/documents/code-projects/relay/Relay/src/merge-hsm";
import { MergeHSM } from "/home/open-claw/documents/code-projects/relay/Relay/src/merge-hsm/MergeHSM";
import { snapshotFromDoc } from "/home/open-claw/documents/code-projects/relay/Relay/src/merge-hsm/snapshots";
import {
	rebaseBufferedTextAcrossReplacement,
	buildBufferedCM6ReplayEvents,
	buildTextChanges,
} from "/home/open-claw/documents/code-projects/relay/Relay/src/merge-hsm/integration/replayBufferedEdits";
void R;

export const P = "alpha\nbravo\ncharlie\n";

export function h(s: string): string {
	let x = 2166136261;
	for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0;
	return "h" + x.toString(16) + ":" + s.length;
}

type Change = { from: number; to: number; insert: string };
function applyChanges(text: string, changes: Change[]): string {
	// CM6 semantics: positions relative to the pre-transaction doc
	let out = "";
	let pos = 0;
	for (const c of [...changes].sort((a, b) => a.from - b.from)) {
		out += text.slice(pos, c.from) + c.insert;
		pos = c.to;
	}
	return out + text.slice(pos);
}

class MockPersistence {
	synced = false;
	private cbs: Array<() => void> = [];
	whenSynced: Promise<unknown>;
	private resolve!: () => void;
	constructor(private doc: Y.Doc, private stored: Uint8Array | null) {
		this.whenSynced = new Promise<void>((r) => (this.resolve = r));
	}
	once(_e: "synced", cb: () => void) { this.cbs.push(cb); }
	fire() {
		if (this.stored) Y.applyUpdate(this.doc, this.stored, this);
		this.synced = true;
		this.resolve();
		const cbs = this.cbs; this.cbs = [];
		cbs.forEach((c) => c());
	}
	hasUserData() { return this.stored !== null; }
	destroy() {}
	set() {}
}

export const tick = async (n = 30) => {
	for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

/** Emulated editor view + HSMEditorPlugin + CM6Integration. */
export class View {
	text: string;
	bound = false;
	viewId: string;
	// HSMEditorPlugin buffering state (HSMEditorPlugin.ts:58-73)
	pendingEdits: { changes: Change[]; docText: string; userEvent?: string }[] = [];
	pendingEditBaseText: string | null = null;
	pendingRestores: { baseText: string; editedText: string; ingestedText?: string }[] = [];
	log: string[] = [];
	constructor(public w: World, public name: string, initial: string) {
		this.text = initial;
		this.viewId = "cm6-" + name;
		w.hsm.effects.subscribe((eff: any) => {
			if (!this.bound) return;
			if (eff.type === "DISPATCH_CM6" && eff.originView !== this.viewId) {
				this.text = applyChanges(this.text, eff.changes);
				this.log.push(`DISPATCH_CM6 -> ${JSON.stringify(this.text)}`);
			}
			if (eff.type === "SET_CM6" && eff.targetView === this.viewId) {
				this.text = eff.text;
				this.log.push(`SET_CM6 -> ${JSON.stringify(this.text)}`);
			}
		});
	}
	/** A user / Obsidian transaction on this editor (not ySync-annotated). */
	bornAttachedEligible = false; // set for a view created while HSM is active.tracking
	renderPending = false;
	tx(changes: Change[], userEvent: string) {
		const start = this.text;
		this.text = applyChanges(this.text, changes);
		this.update(start, changes, userEvent);
	}
	type(at: number | string, s: string, perKey = true) {
		const pos = typeof at === "number" ? at : this.text.indexOf(at) + at.length;
		if (perKey) for (let i = 0; i < s.length; i++) this.tx([{ from: pos + i, to: pos + i, insert: s[i] }], "input.type");
		else this.tx([{ from: pos, to: pos, insert: s }], "input.type");
	}
	del(sub: string) {
		const from = this.text.indexOf(sub);
		this.tx([{ from, to: from + sub.length, insert: "" }], "delete.backward");
	}
	/** Obsidian setViewData full replacement, userEvent "set". */
	set(newText: string) {
		this.tx([{ from: 0, to: this.text.length, insert: newText }], "set");
	}
	// HSMEditorPlugin.update unbound branch (HSMEditorPlugin.ts:860-927) and
	// bound branch -> CM6Integration.onEditorUpdate (CM6Integration.ts:320-366)
	private update(startText: string, changes: Change[], userEvent: string) {
		if (this.bound && !this.renderPending) {
			this.w.hsm.send({ type: "CM6_CHANGE", changes, docText: this.text, viewId: this.viewId, userEvent } as any);
			return;
		}
		if (userEvent === "set") {
			// HSMEditorPlugin.ts:879-885: born-attached bind instead of restore extraction
			if (!this.bound && this.bornAttachedEligible && this.w.hsm.matches("active.tracking")) {
				void this.bindBornAttached();
				return;
			}
			const priorRestores = this.pendingRestores;
			const baseText = this.pendingEditBaseText;
			const editedText = this.pendingEdits.at(-1)?.docText;
			this.pendingEdits = []; this.pendingEditBaseText = null; this.pendingRestores = [];
			const newLayer = baseText !== null && editedText !== undefined
				? [{ baseText, editedText, ingestedText: this.text }] : [];
			this.pendingRestores = [...priorRestores, ...newLayer];
			if (this.pendingRestores.length > 0) queueMicrotask(() => this.flushPendingRestores());
		} else {
			if (this.pendingEdits.length === 0) this.pendingEditBaseText = startText;
			this.pendingEdits.push({ changes, docText: this.text, userEvent });
		}
	}
	// HSMEditorPlugin.flushPendingRestores (HSMEditorPlugin.ts:694-721)
	private flushPendingRestores() {
		const restores = this.pendingRestores; this.pendingRestores = [];
		if (restores.length === 0) return;
		const currentText = this.text;
		let restoredText = currentText;
		const ing = this.w.hsm.getRecentIngestedEditorReplacementTexts();
		for (const layer of restores) {
			if (layer.baseText === layer.editedText) continue;
			const rebased = rebaseBufferedTextAcrossReplacement(layer.baseText, layer.editedText, restoredText,
				layer.ingestedText !== undefined ? [layer.ingestedText, ...ing] : ing);
			if (rebased === null) { this.log.push("restore: rebase failed, dropped"); continue; }
			restoredText = rebased;
		}
		if (restoredText === currentText) return;
		this.log.push(`restore-dispatch ${JSON.stringify(currentText)} -> ${JSON.stringify(restoredText)}`);
		this.tx(buildTextChanges(currentText, restoredText), "input.type");
	}
	/** First-editor bind (HSMEditorPlugin.ts:524-541). */
	bind() {
		this.bound = true;
		this.w.hsm.attachEditorView({ getViewData: () => this.text }, this.text);
		if (this.pendingEdits.length === 0) {
			this.w.hsm.bootstrapEditorView(this.viewId, this.text);
		} else {
			for (const ev of buildBufferedCM6ReplayEvents(this.pendingEdits as any, this.viewId)) this.w.hsm.send(ev as any);
			this.pendingEdits = []; this.pendingEditBaseText = null; this.pendingRestores = [];
		}
	}
	/** Born-attached bind + render (HSMEditorPlugin.ts:514-521, 558-686). */
	async bindBornAttached() {
		this.bound = true;
		this.renderPending = true;
		await Promise.resolve();
		this.renderPending = false;
		const hsm = this.w.hsm;
		const restores = this.pendingRestores;
		const baseText = this.pendingEditBaseText;
		const editedText = this.pendingEdits.at(-1)?.docText;
		this.pendingEdits = []; this.pendingEditBaseText = null; this.pendingRestores = [];
		const localText = hsm.getLocalDoc()!.getText("contents").toString();
		hsm.attachEditorView({ getViewData: () => this.text }, this.text);
		if (this.text !== localText) this.text = localText; // ySync-annotated, not captured
		let targetText = localText;
		const ing = hsm.getRecentIngestedEditorReplacementTexts();
		const buffered = baseText !== null && editedText !== undefined ? [{ baseText, editedText }] : [];
		for (const layer of [...restores, ...buffered] as any[]) {
			if (layer.baseText === layer.editedText) continue;
			const rebased = rebaseBufferedTextAcrossReplacement(layer.baseText, layer.editedText, targetText,
				layer.ingestedText !== undefined ? [layer.ingestedText, ...ing] : ing);
			if (rebased === null) { this.log.push("born-attached: rebase failed, dropped"); continue; }
			targetText = rebased;
		}
		if (targetText === localText) return;
		this.tx(buildTextChanges(localText, targetText), "input.type");
	}
}

export class World {
	hsm: MergeHSM;
	persistence!: MockPersistence;
	remoteDoc: Y.Doc;
	serverDoc: Y.Doc; // other peer
	disk: string;
	mtime = 1000;
	effects: any[] = [];
	states: string[] = [];
	baseUpdate: Uint8Array;

	constructor(opts: { withLca?: boolean; localStored?: string; disk?: string } = {}) {
		const withLca = opts.withLca ?? true;
		const base = new Y.Doc();
		base.clientID = 111;
		base.getText("contents").insert(0, opts.localStored ?? P);
		this.baseUpdate = Y.encodeStateAsUpdate(base);
		this.remoteDoc = new Y.Doc();
		Y.applyUpdate(this.remoteDoc, this.baseUpdate);
		this.serverDoc = new Y.Doc();
		this.serverDoc.clientID = 999;
		Y.applyUpdate(this.serverDoc, this.baseUpdate);
		this.disk = opts.disk ?? P;
		const lcaText = opts.localStored ?? P;
		const lca = withLca
			? { contents: lcaText, meta: { hash: h(lcaText), mtime: this.mtime }, snapshot: snapshotFromDoc(base).snapshot }
			: null;
		this.hsm = new MergeHSM({
			guid: "g1",
			getPath: () => "note.md",
			vaultId: "v",
			remoteDoc: this.remoteDoc,
			hashFn: async (s: string) => h(s),
			createPersistence: (_v: string, doc: Y.Doc) => {
				this.persistence = new MockPersistence(doc, this.baseUpdate);
				return this.persistence as any;
			},
			diskLoader: async () => ({ content: this.disk, hash: h(this.disk), mtime: this.mtime }),
			isProviderSynced: () => true,
			isFolderConnected: () => true,
		} as any);
		this.hsm.effects.subscribe((e: any) => {
			this.effects.push(e);
			if (e.type === "WRITE_DISK") {
				this.disk = e.contents;
				this.mtime++;
				queueMicrotask(() => this.hsm.confirmDiskWrite({ hash: h(e.contents), mtime: this.mtime }));
			}
		});
		this.hsm.onStateChange((_f: string, to: string) => this.states.push(to));
		this.hsm.send({ type: "LOAD", guid: "g1" } as any);
		this.hsm.send({
			type: "PERSISTENCE_LOADED",
			lca,
			disk: { hash: h(this.disk), mtime: this.mtime },
			observedDisk: { hash: h(this.disk), mtime: this.mtime },
		} as any);
		this.hsm.send({ type: "SET_MODE_ACTIVE" } as any);
	}
	open(): void {
		// Obsidian loadFileInternal -> setViewData(disk, clear=true) (main.ts:1580-1600)
		this.hsm.send({ type: "OBSIDIAN_SET_VIEW_DATA", data: this.disk, clear: true } as any);
		this.hsm.send({ type: "ACQUIRE_LOCK" } as any);
	}
	autosave(view: View) {
		this.disk = view.text;
		this.mtime++;
		this.hsm.send({ type: "DISK_CHANGED", contents: this.disk, mtime: this.mtime, hash: h(this.disk) } as any);
	}
	/** Remote peer edits line 1 ("alpha" -> "ALPHA-S"). */
	remoteEdit(find = "alpha", repl = "ALPHA-S") {
		const t = this.serverDoc.getText("contents");
		const sv = Y.encodeStateVector(this.remoteDoc);
		const i = t.toString().indexOf(find);
		this.serverDoc.transact(() => { t.delete(i, find.length); t.insert(i, repl); });
		const upd = Y.encodeStateAsUpdate(this.serverDoc, sv);
		this.hsm.send({ type: "REMOTE_UPDATE", update: upd, affectsText: true } as any);
	}
	async goLive() {
		this.hsm.send({ type: "CONNECTED" } as any);
		this.hsm.send({ type: "PROVIDER_SYNCED" } as any);
		this.persistence.fire();
		await tick();
	}
	local(): string { return this.hsm.getLocalDoc()?.getText("contents").toString() ?? "<null>"; }
	lca(): string | null { return (this.hsm as any)._lca?.contents ?? null; }
	report(label: string, views: View[]) {
		const out: any = {
			state: this.hsm.statePath,
			localDoc: this.local(),
			disk: this.disk,
			LCA: this.lca(),
			remoteDoc: this.remoteDoc.getText("contents").toString(),
		};
		for (const v of views) out[`editor(${v.name})`] = v.text;
		const conflict = (this.hsm as any)._conflict;
		if (conflict) out.conflict = { base: conflict.base ?? conflict._base, ours: conflict.ours, theirs: conflict.theirs };
		out.states = this.states.join(" > ");
		out.effects = this.effects.map((e) => e.type).filter((t) => t !== "PERSIST_STATE" && t !== "STATUS_CHANGED" && t !== "DIAGNOSTIC").join(",");
		for (const v of views) if (v.log.length) out[`log(${v.name})`] = v.log;
		console.log(`\n=== ${label} ===\n` + Object.entries(out).map(([k, v]) => `  ${k}: ${typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)}`).join("\n"));
	}
	drift(view: View) {
		const r = this.hsm.checkAndCorrectDrift(view.text);
		console.log(`  driftCheck(after 3s quiet): ${r ? "DRIFT -> MERGE_CONFLICT, state=" + this.hsm.statePath : "none"}`);
	}
}

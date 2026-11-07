/**
 * Engram#2480 repro, mechanism B (stale disk write-back). RED on main by design.
 *
 * The note is NOT open in an editor (except where a test says it was just
 * closed). An MCP `edit_note` reaches this device through the CRDT path
 * (`applyRemoteUpdate`, what the fan-out / catch-up deliver). Disk then holds
 * text from BEFORE the edit while differing from the recorded baseline, and a
 * disk-driven path (`pushFile` from a modify event, or the cold-start
 * reconcile) diffs that stale text into the doc as a local edit, deleting the
 * MCP section. The doc is what this device ships to the server.
 *
 * Real SyncEngine + createCrdtWiring + ProviderRegistry (the harness from
 * converge-holds-sweep-push.test.ts). No `lcaFor` is wired: in prod it reads
 * BaseStore, which only the legacy REST pull/push paths ever write, so a CRDT
 * note has no merge base and takes the two-way path exercised here.
 *
 * Guards that DID hold (not tests here, see the issue comment): stale disk equal
 * to the baseline is echo-filtered; a flush still in flight is awaited and disk
 * re-read (`applyLocalEdit` pendingFlush loop); cold start skips disk == baseline.
 */
import { afterEach, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../../src/api";
import { CONTENT_KEY } from "../../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../../src/crdt/note-id-map";
import type { ProviderRegistry } from "../../src/crdt/provider-registry";
import { createCrdtWiring } from "../../src/crdt/wiring";
import { fnv1a, SyncEngine } from "../../src/sync";
import { DEFAULT_SETTINGS } from "../../src/types";

const PATH = "Plan.md";
const OLD_SECTION = "old section";
const MCP_SECTION = "new section from MCP";
const V1 = `# Note\n\n## Plan\n${OLD_SECTION}\n\n## Other\nkeep me\n`;
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
let live: ProviderRegistry[] = [];

afterEach(async () => {
	for (const r of live) await r.destroyAll();
	live = [];
});

async function device() {
	const ID = `id-r3-${++seq}`; // unique per file: the merge base persists in the shared fake IndexedDB
	const server = new Y.Doc();
	server.getText(CONTENT_KEY).insert(0, V1);
	const disk = new Map<string, string>([[PATH, V1]]);
	const file = new TFile(PATH);
	const ctl = { bound: false, failWrites: 0, writes: [] as string[] };
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: mock((p: string) => (disk.has(p) ? file : null)),
			getFileByPath: mock((p: string) => (disk.has(p) ? file : null)),
			cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
			modify: mock(async (f: TFile, text: string) => {
				if (ctl.failWrites > 0) {
					ctl.failWrites -= 1;
					throw new Error("EBUSY: resource busy or locked");
				}
				ctl.writes.push(text);
				disk.set(f.path, text);
			}),
			getMarkdownFiles: mock(() => [file]),
			getFiles: mock(() => [file]),
			getName: mock().mockReturnValue("Test Vault"),
		},
		fileManager: { trashFile: mock().mockResolvedValue(undefined) },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	} as any;
	const map = new NoteIdMap();
	map.set(PATH, ID);
	const engine = new SyncEngine(
		app,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 5 },
		mock().mockResolvedValue(undefined),
	);
	const wiring = createCrdtWiring({
		ackScope: () => "s",
		noteIdMap: map,
		syncEngine: engine,
		canSendLive: () => true,
		isBound: () => ctl.bound,
		onBoundUpdate: () => {}, // Obsidian's save nudge; the editor is gone
		sendCrdt: () => true,
	} as any);
	const reg = wiring.manager as ProviderRegistry;
	live.push(reg);
	engine.setCrdtManager(reg);
	engine.setNoteIdMap(map);
	engine.setLiveBoundCheck(() => ctl.bound);
	engine.setCrdtLiveCheck(() => true);
	engine.setReady();
	await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server));
	await tick(10);
	engine.importSyncState({ [PATH]: { hash: fnv1a(V1), crdtHead: "h0" } });

	/** The MCP edit_note replace_section, committed on the server and delivered
	 *  to this device over the CRDT path. */
	const mcpEdit = async () => {
		const before = Y.encodeStateVector(server);
		const t = server.getText(CONTENT_KEY);
		const at = t.toJSON().indexOf(OLD_SECTION);
		server.transact(() => {
			t.delete(at, OLD_SECTION.length);
			t.insert(at, MCP_SECTION);
		});
		await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(server, before)).catch(() => {});
		await tick(20);
	};
	const docText = () => reg.projectedText(ID);
	return { ID, engine: engine as any, reg, disk, file, ctl, mcpEdit, docText };
}

async function expectMcpSectionKept(doc: string) {
	expect(
		doc.includes(OLD_SECTION) ? `REVERTED: doc holds "${OLD_SECTION}" again` : "kept",
		`stale disk diffed into the doc and deleted the MCP section. Doc now:\n${doc}`,
	).toBe("kept");
	expect(doc).toContain(MCP_SECTION);
}

test("r3 N1: the in-doc keep-both nests and grows on each failed copy, and reaches the server", async () => {
	const d = await device();
	const _sent: number[] = [];
	d.engine.keepConflictCopy = async () => false; // e.g. iOS file error, Windows MAX_PATH
	d.ctl.failWrites = 1;
	await d.mcpEdit();
	d.disk.set(PATH, V1.replace(OLD_SECTION, `${OLD_SECTION}.`));
	await d.engine.pushFile(d.file);
	await tick(20);
	const _once = await d.docText();
	// Second round: another remote edit whose flush fails, another stale disk edit.
	const doc = await d.reg.getDoc(d.ID);
	const peer = new Y.Doc();
	Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
	const sv = Y.encodeStateVector(peer);
	const t = peer.getText(CONTENT_KEY);
	const at = t.toJSON().indexOf("keep me");
	peer.transact(() => {
		t.delete(at, 7);
		t.insert(at, "keep me 2");
	});
	d.ctl.failWrites = 1;
	await d.reg.applyRemoteUpdate(d.ID, Y.encodeStateAsUpdate(peer, sv)).catch(() => {});
	await tick(20);
	d.disk.set(PATH, (d.disk.get(PATH) as string).replace("keep me", "keep mE"));
	await d.engine.pushFile(d.file);
	await tick(20);
	const twice = await d.docText();
	const markers = twice.split("Engram kept both").length - 1;
	expect(markers).toBeLessThanOrEqual(1);
});

test("r3 N2: a late close-save that equals the doc still makes a conflict copy", async () => {
	const d = await device();
	const copies: string[] = [];
	d.engine.keepConflictCopy = async (_p: string, text: string) => {
		copies.push(text);
		return true;
	};
	const typed = "typed while open\n";
	const t = (await d.reg.getDoc(d.ID)).getText(CONTENT_KEY);
	t.insert(t.length, typed); // editor-origin edit: localDirty
	// A no-op server frame (fan-out echo of this device's own push) arms localHead.
	await d.reg.applyRemoteUpdate(d.ID, Y.encodeStateAsUpdate(new Y.Doc())).catch(() => {});
	await tick(20);
	const realNow = Date.now;
	Date.now = () => realNow() + 6_000;
	try {
		d.disk.set(PATH, `${V1}${typed}`); // disk == doc: nothing to resolve
		await d.engine.pushFile(d.file);
		await tick(20);
	} finally {
		Date.now = realNow;
	}
	expect(await d.docText()).toBe(`${V1}${typed}`);
	expect(copies).toEqual([]);
});

test("r3 N2b (baseline current): a late close-save that equals the doc still makes a conflict copy", async () => {
	const d = await device();
	const copies: string[] = [];
	d.engine.keepConflictCopy = async (_p: string, text: string) => {
		copies.push(text);
		return true;
	};
	const typed = "typed while open\n";
	const t = (await d.reg.getDoc(d.ID)).getText(CONTENT_KEY);
	t.insert(t.length, typed); // editor-origin edit: localDirty
	// A no-op server frame (fan-out echo of this device's own push) arms localHead.
	await d.reg.applyRemoteUpdate(d.ID, Y.encodeStateAsUpdate(new Y.Doc())).catch(() => {});
	await tick(20);
	const realNow = Date.now;
	Date.now = () => realNow() + 6_000;
	try {
		d.engine.importSyncState({ [PATH]: { hash: fnv1a(`${V1}${typed}`), crdtHead: "h0" } });
		d.disk.set(PATH, `${V1}${typed}`); // disk == doc: nothing to resolve
		await d.engine.pushFile(d.file);
		await tick(20);
	} finally {
		Date.now = realNow;
	}
	expect(await d.docText()).toBe(`${V1}${typed}`);
	expect(copies).toEqual([]);
});

test("r3 N3: a note edited in the editor earlier (live-bound autosave cleared the base) still reverts on B1", async () => {
	const d = await device();
	// The user types in the open note; the binding forwards each keystroke (editor origin).
	const typed = "typed while open\n";
	const t = (await d.reg.getDoc(d.ID)).getText(CONTENT_KEY);
	t.insert(t.length, typed);
	d.ctl.bound = true;
	d.disk.set(PATH, `${V1}${typed}`); // Obsidian's autosave of the same text
	d.engine.handleModify(d.file); // bound: recordLiveBoundBaseline (hash-only, clears the base)
	await tick(50);
	d.ctl.bound = false; // note closed
	d.ctl.failWrites = 1;
	await d.mcpEdit(); // flush fails, disk keeps the pre-MCP text
	expect(d.disk.get(PATH)).toBe(`${V1}${typed}`);
	d.disk.set(PATH, `${V1}${typed}\nupdated: 2026-11-02\n`); // a plugin's footer write
	await d.engine.pushFile(d.file);
	await tick(20);
	await expectMcpSectionKept(await d.docText());
});

test("r3 N3 control (autosave records a real base): a note edited in the editor earlier (live-bound autosave cleared the base) still reverts on B1", async () => {
	const d = await device();
	// The user types in the open note; the binding forwards each keystroke (editor origin).
	const typed = "typed while open\n";
	const t = (await d.reg.getDoc(d.ID)).getText(CONTENT_KEY);
	t.insert(t.length, typed);
	d.ctl.bound = true;
	d.engine.recordLiveBoundBaseline = async (f: TFile) =>
		d.engine.recordCrdtBaseline(f.path, await d.engine.app.vault.cachedRead(f));
	d.disk.set(PATH, `${V1}${typed}`); // Obsidian's autosave of the same text
	d.engine.handleModify(d.file); // bound: recordLiveBoundBaseline (hash-only, clears the base)
	await tick(50);
	d.ctl.bound = false; // note closed
	d.ctl.failWrites = 1;
	await d.mcpEdit(); // flush fails, disk keeps the pre-MCP text
	expect(d.disk.get(PATH)).toBe(`${V1}${typed}`);
	d.disk.set(PATH, `${V1}${typed}\nupdated: 2026-11-02\n`); // a plugin's footer write
	await d.engine.pushFile(d.file);
	await tick(20);
	await expectMcpSectionKept(await d.docText());
});

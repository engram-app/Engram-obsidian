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
import { ProviderRegistry } from "../../src/crdt/provider-registry";
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
	const ID = `id-r4-${++seq}`; // unique per file: the merge base persists in the shared fake IndexedDB
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

test("r4 spam: after one invalidation, only the FIRST differing ingest makes a copy", async () => {
	const d = await device();
	const copies: string[] = [];
	d.engine.keepConflictCopy = async (_p: string, text: string) => {
		copies.push(text);
		return true;
	};
	const other = `${V1}written by another path\n`;
	d.disk.set(PATH, other);
	(d.engine as any).patchSyncedRow(PATH, { hash: fnv1a(other) }); // invalidates
	for (const n of [1, 2, 3]) {
		d.disk.set(PATH, `${d.disk.get(PATH)}user edit ${n}\n`);
		await d.engine.pushFile(d.file);
		await tick(20);
	}
	expect(copies.length).toBeLessThanOrEqual(1);
	expect(await d.docText()).toContain("user edit 3");
});

test("r4 race: invalidateMergeBase while the doc is resident but its base is still loading", async () => {
	const d = await device();
	d.ctl.failWrites = 1;
	await d.mcpEdit(); // base V1 persisted, disk V1, doc MCP
	await d.reg.destroyAll();
	const copies: string[] = [];
	const reg2 = new ProviderRegistry({
		dbPrefix: undefined,
		send: () => true,
		onFlushToDisk: () => true,
		onMergeConflict: async (_id, text) => {
			copies.push(text);
			return true;
		},
	});
	live.push(reg2);
	const p = reg2.getDoc(d.ID); // entry resident, loadMergeBase pending
	reg2.invalidateMergeBase(d.ID, fnv1a("elsewhere"));
	await p;
	await tick(20);
	const e = (reg2 as any).entries.get(d.ID);
	expect(e.mergeBaseInvalid || e.mergeBase === null).toBe(true);
});

test("r4 fm3: a plain disk edit of a note with hand-written frontmatter rewrites the user's frontmatter on disk", async () => {
	const d = await device();
	const disk = `---\ntitle:   x\ntags: [a, "b"]\n# keep this comment\n---\n${V1}`;
	d.disk.set(PATH, disk);
	await d.engine.pushFile(d.file);
	await tick(30);
	const disk2 = `${d.disk.get(PATH)}more\n`;
	d.disk.set(PATH, disk2);
	await d.engine.pushFile(d.file);
	await tick(30);
	expect(d.disk.get(PATH)).toContain("# keep this comment");
});

test("r4 N3-fm: an editor autosave of a note with flow-style tags never becomes the base", async () => {
	const d = await device();
	const fmDisk = `---\ntags: [a, b]\n---\n${V1}`;
	// the note's frontmatter came from another device in this form; the editor shows disk
	d.disk.set(PATH, fmDisk);
	await d.engine.pushFile(d.file);
	await tick(30);
	d.disk.set(PATH, fmDisk); // e.g. the editor buffer still holds the user's form and autosaves it
	const typed = "typed while open\n";
	const t = (await d.reg.getDoc(d.ID)).getText(CONTENT_KEY);
	t.insert(t.length, typed);
	d.ctl.bound = true;
	d.disk.set(PATH, `${fmDisk}${typed}`);
	d.engine.handleModify(d.file);
	await tick(50);
	const e = (d.reg as any).entries.get(d.ID);
	expect(e.mergeBase).toBe(`${fmDisk}${typed}`);
});

test("r4 N3-fm e2e: edited in Obsidian (flow-style tags), closed, MCP flush fails, footer write: MCP edit kept", async () => {
	const d = await device();
	const fmDisk = `---\ntags: [a, b]\n---\n${V1}`;
	d.disk.set(PATH, fmDisk);
	await d.engine.pushFile(d.file);
	await tick(30);
	const typed = "typed while open\n";
	const t = (await d.reg.getDoc(d.ID)).getText(CONTENT_KEY);
	t.insert(t.length, typed);
	d.ctl.bound = true;
	d.disk.set(PATH, `${fmDisk}${typed}`); // editor buffer kept the user's YAML form
	d.engine.handleModify(d.file);
	await tick(50);
	d.ctl.bound = false;
	d.ctl.failWrites = 1;
	await d.mcpEdit();
	d.disk.set(PATH, `${fmDisk}${typed}\nupdated: 2026-11-02\n`);
	await d.engine.pushFile(d.file);
	await tick(20);
	await expectMcpSectionKept(await d.docText());
});

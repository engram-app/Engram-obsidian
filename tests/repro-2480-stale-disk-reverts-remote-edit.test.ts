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
import type { EngramApi } from "../src/api";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry } from "../src/crdt/provider-registry";
import { createCrdtWiring } from "../src/crdt/wiring";
import { fnv1a, reconcileColdStart, SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

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
	const ID = `id-2480-${++seq}`;
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

test("repro 2480 B1: flush write failed, then a plugin's one-line disk write is pushed", async () => {
	const d = await device();
	d.ctl.failWrites = 1; // the remote flush hits EBUSY (mobile / AV lock / sync app)
	await d.mcpEdit();
	expect(await d.docText()).toContain(MCP_SECTION); // the doc holds the edit
	expect(d.disk.get(PATH)).toBe(V1); // disk never got it

	// A plugin (modified-date, linter) or an external editor rewrites the file
	// from what it reads on disk, touching only its own line. Obsidian fires modify -> pushFile.
	d.disk.set(PATH, `${V1}\nupdated: 2026-11-02\n`);
	await d.engine.pushFile(d.file);
	await tick(20);

	await expectMcpSectionKept(await d.docText());
});

test("repro 2480 B2: remote edit applied while bound, the editor's save never wrote it", async () => {
	const d = await device();
	// The note is open: the registry skips the disk write and only nudges the
	// editor to save. The tab closes before that save carries the edit (its
	// close-save had already read the buffer), so disk keeps V1 == baseline.
	d.ctl.bound = true;
	await d.mcpEdit();
	d.ctl.bound = false;
	expect(await d.docText()).toContain(MCP_SECTION);
	expect(d.disk.get(PATH)).toBe(V1);

	// The next unrelated disk write to the closed note is pushed.
	d.disk.set(PATH, `${V1}\nupdated: 2026-11-02\n`);
	await d.engine.pushFile(d.file);
	await tick(20);

	await expectMcpSectionKept(await d.docText());
});

test("repro 2480 B3: file closed while the remote apply is pending, Obsidian's close-save lands late", async () => {
	const d = await device();
	// While open, the user typed a line; the binding forwarded it live, so the
	// doc has it. Obsidian's autosave of that buffer had not hit disk yet.
	const typed = "typed while open\n";
	const buffer = `${V1}${typed}`;
	const t = (await d.reg.getDoc(d.ID)).getText(CONTENT_KEY);
	t.insert(t.length, typed);
	// The user closes the tab: the binding releases, the close-save starts.
	d.ctl.bound = false;
	// The MCP edit arrives now: the note is unbound, so the registry flushes
	// the doc's text to disk and records it as the baseline.
	await d.mcpEdit();
	expect(d.disk.get(PATH)).toContain(MCP_SECTION);
	expect(await d.docText()).toContain(MCP_SECTION);
	// Obsidian's close-save of the pre-edit buffer lands after the flush.
	d.disk.set(PATH, buffer);
	await d.engine.pushFile(d.file); // its modify event
	await tick(20);

	const doc = await d.docText();
	expect(doc).toContain(typed);
	await expectMcpSectionKept(doc);
});

test("repro 2480 B4: cold-start reconcile after the doc persisted the edit but disk did not", async () => {
	const d = await device();
	// The fan-out applied and IndexedDB persisted the edit, then the app was
	// killed (mobile background) before the flush landed: disk still holds V1.
	d.ctl.failWrites = 1;
	await d.mcpEdit();
	expect(await d.docText()).toContain(MCP_SECTION);
	expect(d.disk.get(PATH)).toBe(V1);
	// While Obsidian was closed (or at startup, before Engram), another plugin
	// or app touched its own line of the file.
	d.disk.set(PATH, `${V1}\nupdated: 2026-11-02\n`);

	// main.ts startup loop, verbatim shape.
	const disk = d.disk.get(PATH) as string;
	expect(d.engine.needsColdReconcile(PATH, disk)).toBe(true);
	await reconcileColdStart(
		{ path: PATH, noteId: d.ID, diskContent: disk, reread: async () => d.disk.get(PATH) ?? "" },
		{
			applyLocalEdit: d.reg.applyLocalEdit.bind(d.reg),
			getText: d.reg.getText.bind(d.reg),
			projectedText: d.reg.projectedText.bind(d.reg),
		},
		() => {},
	);

	await expectMcpSectionKept(await d.docText());
});

test("2480 B edge: the merge is written back to disk, so the next disk edit merges from it", async () => {
	const d = await device();
	d.ctl.failWrites = 1;
	await d.mcpEdit();
	d.disk.set(PATH, `${V1}\nupdated: 1\n`);
	await d.engine.pushFile(d.file);
	await tick(20);
	// Disk now holds the merge, not the stale text, and the engine's base is it.
	expect(d.disk.get(PATH)).toBe(await d.docText());
	expect(d.engine.crdtMergeBase(PATH)).toBe(d.disk.get(PATH));

	// A second one-line write on top of the merged disk keeps the MCP section.
	d.disk.set(PATH, `${d.disk.get(PATH)}more\n`);
	await d.engine.pushFile(d.file);
	await tick(20);
	const doc = await d.docText();
	await expectMcpSectionKept(doc);
	expect(doc).toContain("updated: 1");
	expect(doc).toContain("more");
});

test("2480 B edge: a failed write-back leaves the base at the stale disk text", async () => {
	const d = await device();
	d.ctl.failWrites = 2; // the remote flush AND the write-back hit EBUSY
	await d.mcpEdit();
	const stale = `${V1}\nupdated: 1\n`;
	d.disk.set(PATH, stale);
	await d.engine.pushFile(d.file);
	await tick(20);
	expect(d.disk.get(PATH)).toBe(stale);
	expect(d.engine.crdtMergeBase(PATH)).toBe(stale); // what disk actually holds

	d.disk.set(PATH, `${stale}more\n`);
	await d.engine.pushFile(d.file);
	await tick(20);
	const doc = await d.docText();
	await expectMcpSectionKept(doc);
	expect(doc).toContain("more");
});

test("2480 B edge: a base the baseline moved past is not used", async () => {
	const d = await device();
	expect(d.engine.crdtMergeBase(PATH)).toBe(V1);
	d.engine.importSyncState({ [PATH]: { hash: fnv1a("something else"), crdtHead: "h0" } });
	expect(d.engine.crdtMergeBase(PATH)).toBeNull();
});

test("2480 B3 edge: a disk text the doc held but no local edit preceded is ingested normally", async () => {
	const d = await device();
	await d.mcpEdit(); // flush lands: disk == doc == MCP text
	// No local edit before the remote merge, so V1 is not the doc's local
	// head: a user who restores V1 on disk by hand gets V1.
	d.disk.set(PATH, V1);
	await d.engine.pushFile(d.file);
	await tick(20);
	expect(await d.docText()).toBe(V1);
});

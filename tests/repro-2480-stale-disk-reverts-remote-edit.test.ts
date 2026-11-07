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
import { BaseStore } from "../src/base-store";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
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
	expect(d.disk.get(PATH)).toBe(await d.docText()); // disk holds the merge

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

	d.disk.set(PATH, `${stale}more\n`);
	await d.engine.pushFile(d.file);
	await tick(20);
	const doc = await d.docText();
	await expectMcpSectionKept(doc);
	expect(doc).toContain("more");
});

test("2480 B edge: a disk text the doc held but no local edit preceded is ingested normally", async () => {
	const d = await device();
	await d.mcpEdit(); // flush lands: disk == doc == MCP text
	d.disk.set(PATH, V1); // a user restores V1 by hand
	await d.engine.pushFile(d.file);
	await tick(20);
	expect(await d.docText()).toBe(V1);
});

test("2480 B edge: same-line overlap is a keep-both conflict, not an interleave", async () => {
	const d = await device();
	const copies: string[] = [];
	d.engine.keepConflictCopy = async (_p: string, text: string) => {
		copies.push(text);
		return true;
	};
	d.ctl.failWrites = 1;
	await d.mcpEdit();
	// A linter rewrote the very line MCP replaced.
	const linted = V1.replace(OLD_SECTION, `${OLD_SECTION}.`);
	d.disk.set(PATH, linted);
	await d.engine.pushFile(d.file);
	await tick(20);
	const doc = await d.docText();
	await expectMcpSectionKept(doc);
	expect(doc).not.toContain(`${MCP_SECTION}.`);
	expect(copies).toEqual([linted]);
	expect(d.disk.get(PATH)).toBe(doc);
});

test("2480 B edge: the merge base survives a restart (persisted per note)", async () => {
	const d = await device();
	d.ctl.failWrites = 1;
	await d.mcpEdit(); // base stays V1, disk V1, doc MCP
	await d.reg.destroyAll(); // app killed: the in-memory entry is gone
	const reg2 = new ProviderRegistry({
		dbPrefix: undefined,
		send: () => true,
		onFlushToDisk: () => true,
		isUnchangedSynced: (_id, c) => fnv1a(c) === fnv1a(V1),
	});
	live.push(reg2);
	const disk = `${V1}\nupdated: 2026-11-02\n`;
	await reg2.applyLocalEdit(d.ID, disk);
	await expectMcpSectionKept(await reg2.projectedText(d.ID));
});

// Adversarial review of PR 683 (findings 1 and 2), verbatim.
test("review 683 R1: localHead never expires and swallows a deliberate external revert later", async () => {
	const d = await device();
	const mine = `${V1}local line\n`;
	d.disk.set(PATH, mine);
	await d.engine.pushFile(d.file);
	await tick(20);
	await d.mcpEdit(); // localHead = hash(mine); the flush lands, disk == doc
	expect(d.disk.get(PATH)).toContain(MCP_SECTION);
	await tick(50); // no late close-save ever comes
	d.disk.set(PATH, mine); // user restores the old text (git checkout -- Plan.md)
	await d.engine.pushFile(d.file);
	await tick(20);
	expect(await d.docText()).toBe(mine); // PR: doc keeps the MCP text and writes it back
	expect(d.disk.get(PATH)).toBe(mine);
});

test("review 683 R3: external edit then external undo is discarded when any server frame landed in between", async () => {
	const d = await device();
	const d1 = `${V1}first external edit\n`;
	d.disk.set(PATH, d1);
	await d.engine.pushFile(d.file); // local origin: localDirty = true
	await tick(20);
	// Any provider/REMOTE transaction (fan-out echo, handshake) pins localHead = hash(d1).
	await d.reg.applyRemoteUpdate(d.ID, Y.encodeStateAsUpdate(new Y.Doc())).catch(() => {});
	await tick(20);
	const d2 = `${V1}second external edit\n`;
	d.disk.set(PATH, d2);
	await d.engine.pushFile(d.file);
	await tick(20);
	expect(await d.docText()).toBe(d2);
	d.disk.set(PATH, d1); // undo in the external editor
	await d.engine.pushFile(d.file);
	await tick(20);
	expect(await d.docText()).toBe(d1); // PR: "second external edit"
	expect(d.disk.get(PATH)).toBe(d1);
});

test("review 683 R2: cold start with no persisted base (crash / first run after upgrade) still reverts", async () => {
	const d = await device();
	d.ctl.failWrites = 1;
	await d.mcpEdit();
	expect(d.disk.get(PATH)).toBe(V1);
	d.engine.baseStore = new BaseStore({ read: async () => "", write: async () => {} }, "");
	d.disk.set(PATH, `${V1}\nupdated: 2026-11-02\n`);
	const disk = d.disk.get(PATH) as string;
	await reconcileColdStart(
		{ path: PATH, noteId: d.ID, diskContent: disk, reread: async () => d.disk.get(PATH) ?? "" },
		{
			applyLocalEdit: d.reg.applyLocalEdit.bind(d.reg),
			getText: d.reg.getText.bind(d.reg),
			projectedText: d.reg.projectedText.bind(d.reg),
		},
		() => {},
	);
	await expectMcpSectionKept(await d.docText()); // REVERTED
});

test("2480 B3 edge: the first ingest closes the editor-echo window, match or not", async () => {
	const d = await device();
	const typed = "typed while open\n";
	const t = (await d.reg.getDoc(d.ID)).getText(CONTENT_KEY);
	t.insert(t.length, typed); // editor-origin edit
	await d.mcpEdit(); // arms the window; the flush lands
	// An unrelated disk edit is ingested first: the window closes.
	d.disk.set(PATH, `${d.disk.get(PATH)}other\n`);
	await d.engine.pushFile(d.file);
	await tick(20);
	// A revert to the buffer text, still inside the cooldown, now wins.
	d.disk.set(PATH, `${V1}${typed}`);
	await d.engine.pushFile(d.file);
	await tick(20);
	expect(await d.docText()).toBe(`${V1}${typed}`);
});

// Delta review of PR 683 at 4924e016 (findings D1 to D4), verbatim except
// where noted.

/** A second remote edit, built from the device's own doc state. */
async function remoteEdit(d: Awaited<ReturnType<typeof device>>, from: string, to: string) {
	const local = await d.reg.getDoc(d.ID);
	const peer = new Y.Doc();
	Y.applyUpdate(peer, Y.encodeStateAsUpdate(local));
	const before = Y.encodeStateVector(peer);
	const t = peer.getText(CONTENT_KEY);
	const at = t.toJSON().indexOf(from);
	peer.transact(() => {
		t.delete(at, from.length);
		t.insert(at, to);
	});
	await d.reg.applyRemoteUpdate(d.ID, Y.encodeStateAsUpdate(peer, before)).catch(() => {});
	await tick(20);
}

test("D1 timing: close-save landing 6 s after the remote merge reverts the MCP edit", async () => {
	const d = await device();
	const copies: string[] = [];
	d.engine.keepConflictCopy = async (_p: string, text: string) => {
		copies.push(text);
		return true;
	};
	const typed = "typed while open\n";
	const t = (await d.reg.getDoc(d.ID)).getText(CONTENT_KEY);
	t.insert(t.length, typed); // editor-origin edit
	d.ctl.bound = false;
	await d.mcpEdit(); // arms localHead; flush lands, base = flushed text
	const realNow = Date.now;
	Date.now = () => realNow() + 6_000; // slow mobile fs / app suspended mid-window
	try {
		d.disk.set(PATH, `${V1}${typed}`); // the late close-save of the pre-merge buffer
		await d.engine.pushFile(d.file);
		await tick(20);
	} finally {
		Date.now = realNow;
	}
	await expectMcpSectionKept(await d.docText());
	// Added: past the window it is a keep-both, not a silent drop.
	expect(copies).toEqual([`${V1}${typed}`]);
});

test("D2 crash: merge base (eager IDB) ahead of syncState (lazy data.json) drops to the two-way path", async () => {
	const d = await device();
	await d.mcpEdit(); // flush lands: base = T2 written to IDB at once; hash H2 only in memory
	expect(d.disk.get(PATH)).toContain(MCP_SECTION);
	const t2 = d.disk.get(PATH) as string;
	d.ctl.failWrites = 1;
	await remoteEdit(d, "# Note", "# Note EDIT2"); // doc T3, flush fails, disk T2
	expect(d.disk.get(PATH)).toBe(t2);
	await d.reg.destroyAll(); // crash: data.json was last saved with hash(V1)
	const reg2 = new ProviderRegistry({
		dbPrefix: undefined,
		send: () => true,
		onFlushToDisk: () => true,
		isUnchangedSynced: (_id, c) => fnv1a(c) === fnv1a(V1), // stale persisted syncState
	});
	live.push(reg2);
	await reg2.applyLocalEdit(d.ID, `${t2}\nupdated: 2026-11-02\n`);
	expect(await reg2.projectedText(d.ID)).toContain("# Note EDIT2");
});

test("D3 upgrade: no persisted base yet (first launch of this version) still reverts", async () => {
	const d = await device();
	// Changed from the review: the upgrade happens BEFORE the failed flush.
	// As written (base dropped after the flush failed) no copy of V1 exists
	// anywhere on the device, so nothing could merge from it; the real
	// upgrade launches with no key and then sees disk at the baseline.
	(d.reg as any).entries.get(d.ID).mergeBase = null; // pre-upgrade IDB has no merge-base key
	d.ctl.failWrites = 1;
	await d.mcpEdit();
	d.disk.set(PATH, `${V1}\nupdated: 2026-11-02\n`);
	await d.engine.pushFile(d.file);
	await tick(20);
	await expectMcpSectionKept(await d.docText());
});

test("D4 adjacency: a plugin line written right under the MCP-edited line makes a conflict copy", async () => {
	const d = await device();
	const copies: string[] = [];
	d.engine.keepConflictCopy = async (_p: string, text: string) => {
		copies.push(text);
		return true;
	};
	d.ctl.failWrites = 1;
	await d.mcpEdit();
	d.disk.set(PATH, V1.replace(`${OLD_SECTION}\n`, `${OLD_SECTION}\n- [ ] follow up\n`));
	await d.engine.pushFile(d.file);
	await tick(20);
	expect(copies).toEqual([]); // no conflict copy for edits on different lines
	// Added: both edits landed.
	const doc = await d.docText();
	await expectMcpSectionKept(doc);
	expect(doc).toContain("- [ ] follow up");
});

test("D4 fallback: a true conflict with no copy handler keeps both in the doc, never reverts", async () => {
	const d = await device();
	d.engine.keepConflictCopy = async () => false; // the copy cannot be written
	d.ctl.failWrites = 1;
	await d.mcpEdit();
	const linted = V1.replace(OLD_SECTION, `${OLD_SECTION}.`);
	d.disk.set(PATH, linted);
	await d.engine.pushFile(d.file);
	await tick(20);
	const doc = await d.docText();
	expect(doc).toContain(MCP_SECTION); // the remote edit survives
	expect(doc).toContain(`${OLD_SECTION}.`); // and so does disk's edit
	expect(d.disk.get(PATH)).toBe(doc);
});

test("D4 last line plus an EOF append merges with no copy handler", async () => {
	const d = await device();
	d.ctl.failWrites = 1;
	await remoteEdit(d, "keep me", "keep me edited");
	d.disk.set(PATH, `${V1}updated: 2026-11-02\n`);
	await d.engine.pushFile(d.file);
	await tick(20);
	const doc = await d.docText();
	expect(doc).toContain("keep me edited\n");
	expect(doc).toContain("updated: 2026-11-02");
});

// Invariant: no caller can hand merge3 a base that is not a true common
// ancestor. For the disk ingest, a baseline that moved through a writer that
// records no base makes the old base no ancestor of disk; it is detected and
// the ingest is a keep-both (conflict copy), never a merge or a two-way diff.
test("invariant: a disk base the baseline moved past goes to the conflict copy (resident)", async () => {
	const d = await device();
	const copies: string[] = [];
	d.engine.keepConflictCopy = async (_p: string, text: string) => {
		copies.push(text);
		return true;
	};
	d.ctl.failWrites = 1;
	await d.mcpEdit(); // base V1, disk V1, doc MCP
	const other = `${V1}written by another path\n`;
	d.disk.set(PATH, other);
	(d.engine as any).patchSyncedRow(PATH, { hash: fnv1a(other) }); // hash, no base
	d.disk.set(PATH, `${other}then edited\n`);
	await d.engine.pushFile(d.file);
	await tick(20);
	expect(copies).toEqual([`${other}then edited\n`]);
	const doc = await d.docText();
	await expectMcpSectionKept(doc);
	expect(doc).not.toContain("then edited"); // no merge from the stale base
	expect(d.disk.get(PATH)).toBe(doc);
});

test("invariant: a disk base the baseline moved past goes to the conflict copy (not resident)", async () => {
	const d = await device();
	d.ctl.failWrites = 1;
	await d.mcpEdit(); // base V1 persisted
	await d.reg.destroyAll(); // the doc is evicted; only its IndexedDB record remains
	(d.engine as any).patchSyncedRow(PATH, { hash: fnv1a("elsewhere") });
	await tick(50); // the record is marked straight in IndexedDB
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
	const disk = `${V1}\nupdated: 2026-11-02\n`;
	await reg2.applyLocalEdit(d.ID, disk);
	expect(copies).toEqual([disk]);
	await expectMcpSectionKept(await reg2.projectedText(d.ID));
});

// Frontmatter is compared by meaning, never as serialised strings: the codec
// re-serialises YAML (flow lists become block lists, comments and spacing
// go), and no write may rewrite what the user wrote when the meaning is the
// same.
const HAND_FM = `---\ntitle:   x\ntags: [a, "b"]\n# keep this comment\naliases:\n  - c\n  - d\n---\n`;

async function withHandFrontmatter() {
	const d = await device();
	d.disk.set(PATH, `${HAND_FM}${V1}`);
	await d.engine.pushFile(d.file);
	await tick(30);
	return d;
}

test("2480 fm: an ingest of hand-written frontmatter writes nothing back", async () => {
	const d = await withHandFrontmatter();
	const writes = d.ctl.writes.length;
	d.disk.set(PATH, `${d.disk.get(PATH)}more\n`); // a plain body append
	await d.engine.pushFile(d.file);
	await tick(30);
	expect(d.ctl.writes.length).toBe(writes); // disk and doc mean the same
	expect(d.disk.get(PATH)).toBe(`${HAND_FM}${V1}more\n`);
});

test("2480 fm: a remote body edit keeps the user's YAML bytes on disk", async () => {
	const d = await withHandFrontmatter();
	await d.mcpEdit(); // the flush writes the MCP body
	const disk = d.disk.get(PATH) as string;
	expect(disk).toContain(MCP_SECTION);
	expect(disk.startsWith(HAND_FM)).toBe(true); // flow list, comment, spacing kept
});

test("2480 fm: a disk edit inside the block merges with a remote body edit, no copy", async () => {
	const d = await withHandFrontmatter();
	const copies: string[] = [];
	d.engine.keepConflictCopy = async (_p: string, text: string) => {
		copies.push(text);
		return true;
	};
	d.ctl.failWrites = 1;
	await d.mcpEdit(); // doc holds the MCP body, disk does not
	const edited = `${HAND_FM.replace('[a, "b"]', '[a, "b", z]')}${V1}`;
	d.disk.set(PATH, edited);
	await d.engine.pushFile(d.file);
	await tick(30);
	expect(copies).toEqual([]);
	const doc = await d.docText();
	await expectMcpSectionKept(doc);
	expect(doc).toContain("- z"); // the doc took the new tag
	const disk = d.disk.get(PATH) as string;
	expect(disk).toContain(MCP_SECTION);
	expect(disk).toContain("# keep this comment"); // the user's block survived the write-back
	expect(disk).toContain('tags: [a, "b", z]');
});

test("2480 fm: a remote change that MEANS something different is still written", async () => {
	const d = await withHandFrontmatter();
	const doc = await d.reg.getDoc(d.ID);
	const peer = new Y.Doc();
	Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
	const sv = Y.encodeStateVector(peer);
	peer.getMap("frontmatter").set("title", JSON.stringify("changed"));
	await d.reg.applyRemoteUpdate(d.ID, Y.encodeStateAsUpdate(peer, sv)).catch(() => {});
	await tick(30);
	expect(d.disk.get(PATH)).toContain("title: changed");
});

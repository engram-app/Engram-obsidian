/**
 * First sync of notes whose frontmatter the codec re-serialises must not
 * drift-copy them (Engram#1928 class), now that a flush keeps disk's own
 * frontmatter bytes when they mean the same (PR 683, `keepDiskFrontmatter`).
 *
 * The genesis apply flushes the doc's projection; with equal meaning the
 * flush writes NOTHING and disk keeps the raw bytes. The create-ack baseline
 * must then be those raw bytes, not the projection: a baseline no file holds
 * makes the next catch-up read the note as locally edited (backend e2e
 * test_101: 7 conflict copies). Real SyncEngine + createCrdtWiring +
 * ProviderRegistry; the shapes are the backend fixture's DRIFTING_SHAPES.
 */
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { NoteIdMap } from "../src/crdt/note-id-map";
import type { ProviderRegistry } from "../src/crdt/provider-registry";
import { createCrdtWiring } from "../src/crdt/wiring";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

// e2e/helpers/frontmatter_first_sync.py DRIFTING_SHAPES (backend repo).
const SHAPES: Record<string, string> = {
	"wikilink-and-empty": '---\nup: "[[Home]]"\nstatus:\n---\n',
	"hashtag-and-flow-list": '---\ntag: "#project"\ntags: [a, b]\n---\n',
	"wikilink-and-quoted-title": '---\nup: "[[Home]]"\ntitle: "Hello"\n---\n',
	"colon-and-comment": '---\ntitle: "Meeting: kickoff" # agenda below\n---\n',
	"aliases-flow-wikilinks": '---\naliases: ["[[Alpha]]", "[[Beta]]"]\n---\n',
	"tilde-null": "---\nstatus: ~\n---\n",
	"yes-string": '---\nanswer: "yes"\n---\n',
	"obsidian-cssclasses": "---\ncssclasses: \n---\n",
};

let seq = 0;
for (const [name, fm] of Object.entries(SHAPES)) {
	test(`first sync of "${name}" frontmatter: create-ack baseline is what disk holds`, async () => {
		const PATH = `FmFirstSync/${name}.md`;
		const ID = `fm-first-sync-${++seq}`;
		const raw = `${fm}body of ${name}\n`;
		const disk = new Map<string, string>([[PATH, raw]]);
		const file = new TFile(PATH);
		const app = {
			vault: {
				configDir: ".obsidian",
				getAbstractFileByPath: mock((p: string) => (disk.has(p) ? file : null)),
				getFileByPath: mock((p: string) => (disk.has(p) ? file : null)),
				cachedRead: mock(async (f: TFile) => disk.get(f.path) ?? ""),
				read: mock(async (f: TFile) => disk.get(f.path) ?? ""),
				modify: mock(async (f: TFile, text: string) => void disk.set(f.path, text)),
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
		) as any;
		const wiring = createCrdtWiring({
			ackScope: () => "s",
			noteIdMap: map,
			syncEngine: engine,
			canSendLive: () => true,
			isBound: () => false,
			onBoundUpdate: () => {},
			sendCrdt: () => true,
		} as any);
		const reg = wiring.manager as ProviderRegistry;
		engine.setCrdtManager(reg);
		engine.setNoteIdMap(map);
		engine.setLiveBoundCheck(() => false);
		engine.setCrdtLiveCheck(() => true);
		engine.setReady();
		try {
			const consumed = await engine.seedBodyAfterCreate({
				effectiveId: ID,
				normalized: PATH,
				file,
				seeded: true,
				sameId: true,
				genesisOutcome: "stored",
				genesisUpdate: reg.encodeGenesisUpdate(raw),
				genesisContent: raw,
			});
			await engine.adoptCreateAck(ID, PATH, consumed, { flushHeld: false });

			const now = disk.get(PATH) as string;
			expect(now).toBe(raw); // equal by meaning: the user's bytes are kept
			// Disk untouched since the apply must read as synced, or catch-up
			// drift-copies the note.
			expect(engine.isUnchangedSynced(PATH, now)).toBe(true);
			expect(engine.needsColdReconcile(PATH, now)).toBe(false);
		} finally {
			await reg.destroyAll();
		}
	});
}

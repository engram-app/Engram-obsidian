/**
 * Shared harness for the first-sync frontmatter tests (Engram#1928 class,
 * PR 683): a real SyncEngine + createCrdtWiring + ProviderRegistry over an
 * in-memory vault, and the backend e2e fixture's frontmatter shapes.
 */
import { mock } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import type { EngramApi } from "../../src/api";
import { NoteIdMap } from "../../src/crdt/note-id-map";
import type { ProviderRegistry } from "../../src/crdt/provider-registry";
import { createCrdtWiring } from "../../src/crdt/wiring";
import { SyncEngine } from "../../src/sync";
import { DEFAULT_SETTINGS } from "../../src/types";

/** e2e/helpers/frontmatter_first_sync.py DRIFTING_SHAPES (backend repo):
 *  each one's raw bytes, the plugin's re-emit and the backend's differ. */
export const FM_SHAPES: Record<string, string> = {
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

/** One note at `FmFirstSync/<name>.md` holding `initial` on disk. */
export function fmDevice(name: string, initial: string) {
	const PATH = `FmFirstSync/${name}.md`;
	const ID = `fm-first-sync-${++seq}`;
	const disk = new Map<string, string>([[PATH, initial]]);
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
	const copies: string[] = [];
	engine.writeDriftConflictCopy = async (p: string, text: string) => {
		copies.push(text);
		return `${p}.copy`;
	};
	/** Disk now, and whether the engine's baseline vouches for exactly it. */
	const diskSynced = () => {
		const now = disk.get(PATH) as string;
		return {
			now,
			synced: engine.isUnchangedSynced(PATH, now) && !engine.needsColdReconcile(PATH, now),
		};
	};
	return { PATH, ID, disk, file, engine, reg, copies, diskSynced };
}

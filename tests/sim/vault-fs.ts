// tests/sim/vault-fs.ts
/** fs-backed vault adapter for the convergence sim: a REAL SyncEngine can
 *  boot against this and read/write real files under `rootDir`, with the
 *  same TFile/TFolder identities the engine's `instanceof` checks use
 *  (imported directly from tests/__mocks__/obsidian.ts — trap T1, see brief).
 *
 *  Deliberately dumb: every method is a direct node:fs call plus a flat
 *  `Map<path, TFile>` index rebuilt from disk after every mutation. No fs
 *  watchers — the sim fires vault events explicitly (via `VaultEvents`) so a
 *  run's event ordering is deterministic, not a race with the OS.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { TFile, TFolder } from "../__mocks__/obsidian";

/** Callbacks the sim wires to the SyncEngine's vault-event handlers, mirroring
 *  src/main.ts's `registerEvent(this.app.vault.on(...))` wiring:
 *    - modify        -> syncEngine.handleModify(file)                 (main.ts:576-578)
 *    - create        -> TFolder ? handleFolderCreate(file) : handleModify(file)  (main.ts:852-857)
 *    - delete        -> TFolder ? handleFolderDelete(file) : handleDelete(file)  (main.ts:609-614)
 *    - rename        -> syncEngine.handleRename(file, oldPath)        (main.ts:618-619)
 *  `create`/`delete` fire for folders too in real Obsidian; the folder-vs-file
 *  branch lives with whoever wires these callbacks (they hold the SimApp and
 *  can check `vault.getAbstractFileByPath`), not in this dumb path-only shape. */
export interface VaultEvents {
	onModify?(path: string): void;
	onCreate?(path: string): void;
	onDelete?(path: string): void;
	onRename?(oldPath: string, newPath: string): void;
}

export interface SimApp {
	vault: {
		configDir: string;
		getFileByPath(path: string): TFile | null;
		getAbstractFileByPath(path: string): TFile | TFolder | null;
		getFiles(): TFile[];
		getAllLoadedFiles(): (TFile | TFolder)[];
		getMarkdownFiles(): TFile[];
		read(file: TFile): Promise<string>;
		cachedRead(file: TFile): Promise<string>;
		readBinary(file: TFile): Promise<ArrayBuffer>;
		create(path: string, data: string): Promise<TFile>;
		createBinary(path: string, data: ArrayBuffer): Promise<TFile>;
		createFolder(path: string): Promise<TFolder>;
		modify(file: TFile, data: string): Promise<void>;
		modifyBinary(file: TFile, data: ArrayBuffer): Promise<void>;
		process(file: TFile, fn: (data: string) => string): Promise<string>;
		rename(file: TFile, newPath: string): Promise<void>;
		getName(): string;
	};
	fileManager: {
		trashFile(file: TFile | TFolder): Promise<void>;
	};
	workspace: {
		openLinkText(linktext: string, sourcePath: string): void;
		getActiveViewOfType<T>(_type: unknown): T | null;
	};
}

export function makeVault(rootDir: string, events: VaultEvents = {}): SimApp {
	fs.mkdirSync(rootDir, { recursive: true });

	/** Flat file index, rebuilt from disk after every mutation. Folders are
	 *  never cached here — getAbstractFileByPath/getAllLoadedFiles walk disk
	 *  directly, since they're called far less often than file lookups. */
	let index = new Map<string, TFile>();

	function abs(relPath: string): string {
		return path.join(rootDir, relPath);
	}

	function walkFiles(rel: string, out: Map<string, TFile>): void {
		for (const entry of fs.readdirSync(abs(rel) || rootDir, { withFileTypes: true })) {
			const childRel = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walkFiles(childRel, out);
			else if (entry.isFile()) {
				const stat = fs.statSync(abs(childRel));
				out.set(childRel, new TFile(childRel, stat.mtimeMs, stat.size));
			}
		}
	}

	function rebuildIndex(): void {
		const next = new Map<string, TFile>();
		walkFiles("", next);
		index = next;
	}
	rebuildIndex();

	function ensureParentDir(relPath: string): void {
		fs.mkdirSync(path.dirname(abs(relPath)), { recursive: true });
	}

	/** Builds a TFolder tree rooted at `rel` ("" = vault root, displayed as
	 *  "/" like real Obsidian). Recursive so subtreeHasSyncableFile-style
	 *  callers (sync.ts:2280) can walk `.children` correctly. */
	function buildFolder(rel: string): TFolder {
		const displayPath = rel === "" ? "/" : rel;
		const children: (TFile | TFolder)[] = [];
		for (const entry of fs.readdirSync(abs(rel) || rootDir, { withFileTypes: true })) {
			const childRel = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) children.push(buildFolder(childRel));
			else if (entry.isFile()) children.push(index.get(childRel) ?? new TFile(childRel));
		}
		return new TFolder(displayPath, children);
	}

	function collectAllLoadedFiles(folder: TFolder, out: (TFile | TFolder)[]): void {
		out.push(folder);
		for (const child of folder.children) {
			if (child instanceof TFolder) collectAllLoadedFiles(child, out);
			else out.push(child);
		}
	}

	/** Writes atomically: temp file + rename, mirroring Obsidian's own
	 *  atomic write behavior (vault.process()'s read-modify-write can't
	 *  observe a partial write). */
	function atomicWrite(relPath: string, data: string | Buffer): void {
		ensureParentDir(relPath);
		const target = abs(relPath);
		const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
		fs.writeFileSync(tmp, data);
		fs.renameSync(tmp, target);
	}

	const vault: SimApp["vault"] = {
		configDir: ".obsidian",

		getFileByPath(p) {
			return index.get(p) ?? null;
		},

		getAbstractFileByPath(p) {
			const file = index.get(p);
			if (file) return file;
			const isRoot = p === "" || p === "/";
			if (isRoot || fs.existsSync(abs(p))) {
				return buildFolder(isRoot ? "" : p);
			}
			return null;
		},

		getFiles() {
			return [...index.values()];
		},

		getAllLoadedFiles() {
			const out: (TFile | TFolder)[] = [];
			collectAllLoadedFiles(buildFolder(""), out);
			return out;
		},

		getMarkdownFiles() {
			return [...index.values()].filter((f) => f.extension === "md");
		},

		async read(file) {
			return fs.readFileSync(abs(file.path), "utf8");
		},

		async cachedRead(file) {
			return fs.readFileSync(abs(file.path), "utf8");
		},

		async readBinary(file) {
			const buf = fs.readFileSync(abs(file.path));
			return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
		},

		async create(p, data) {
			atomicWrite(p, data);
			rebuildIndex();
			events.onCreate?.(p);
			return index.get(p)!;
		},

		async createBinary(p, data) {
			atomicWrite(p, Buffer.from(data));
			rebuildIndex();
			events.onCreate?.(p);
			return index.get(p)!;
		},

		async createFolder(p) {
			fs.mkdirSync(abs(p), { recursive: true });
			events.onCreate?.(p);
			return buildFolder(p);
		},

		async modify(file, data) {
			atomicWrite(file.path, data);
			rebuildIndex();
			events.onModify?.(file.path);
		},

		async modifyBinary(file, data) {
			atomicWrite(file.path, Buffer.from(data));
			rebuildIndex();
			events.onModify?.(file.path);
		},

		async process(file, fn) {
			const current = fs.readFileSync(abs(file.path), "utf8");
			const next = fn(current);
			atomicWrite(file.path, next);
			rebuildIndex();
			events.onModify?.(file.path);
			return next;
		},

		async rename(file, newPath) {
			const oldPath = file.path;
			ensureParentDir(newPath);
			fs.renameSync(abs(oldPath), abs(newPath));
			rebuildIndex();
			events.onRename?.(oldPath, newPath);
		},

		getName() {
			return path.basename(rootDir);
		},
	};

	const fileManager: SimApp["fileManager"] = {
		async trashFile(file) {
			const p = file.path;
			// Fire before removal: real Obsidian's delete listener still resolves
			// the entity (type + path) at event time, and callers rely on that
			// for TFile/TFolder disambiguation (see VaultEvents docstring above).
			events.onDelete?.(p);
			fs.rmSync(abs(p), { recursive: true, force: true });
			rebuildIndex();
		},
	};

	const workspace: SimApp["workspace"] = {
		openLinkText() {
			// no-op — the sim never opens a leaf.
		},
		getActiveViewOfType<T>(): T | null {
			return null;
		},
	};

	return { vault, fileManager, workspace };
}

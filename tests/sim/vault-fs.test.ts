// tests/sim/vault-fs.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TFile, TFolder } from "../__mocks__/obsidian";
import { makeVault, type VaultEvents } from "./vault-fs";

describe("makeVault", () => {
	let rootDir: string;

	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-sim-vault-"));
	});
	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	test("create/read/modify/rename round-trip on a real temp dir", async () => {
		const app = makeVault(rootDir, {});
		await app.vault.create("Notes/a.md", "hello");
		expect(await app.vault.read(app.vault.getFileByPath("Notes/a.md")!)).toBe("hello");

		await app.vault.modify(app.vault.getFileByPath("Notes/a.md")!, "world");
		expect(await app.vault.cachedRead(app.vault.getFileByPath("Notes/a.md")!)).toBe("world");

		await app.vault.rename(app.vault.getFileByPath("Notes/a.md")!, "Notes/b.md");
		expect(app.vault.getFileByPath("Notes/a.md")).toBeNull();
		expect(await app.vault.read(app.vault.getFileByPath("Notes/b.md")!)).toBe("world");

		// physically on disk too, since it's fs-backed
		expect(fs.existsSync(path.join(rootDir, "Notes/b.md"))).toBe(true);
		expect(fs.existsSync(path.join(rootDir, "Notes/a.md"))).toBe(false);
	});

	test("getFileByPath / getFiles / getMarkdownFiles return real TFile instances", async () => {
		const app = makeVault(rootDir, {});
		await app.vault.create("Notes/a.md", "hi");
		await app.vault.create("Assets/img.png", "binarydata");

		const f = app.vault.getFileByPath("Notes/a.md");
		expect(f).toBeInstanceOf(TFile);

		const all = app.vault.getFiles();
		expect(all).toHaveLength(2);
		expect(all.every((x) => x instanceof TFile)).toBe(true);

		const md = app.vault.getMarkdownFiles();
		expect(md).toHaveLength(1);
		expect(md[0]!.path).toBe("Notes/a.md");
	});

	test("getAbstractFileByPath returns instanceof TFolder for directories, with children", async () => {
		const app = makeVault(rootDir, {});
		await app.vault.create("Notes/a.md", "hi");

		const folder = app.vault.getAbstractFileByPath("Notes");
		expect(folder).toBeInstanceOf(TFolder);
		expect((folder as TFolder).children).toHaveLength(1);
		expect((folder as TFolder).children[0]).toBeInstanceOf(TFile);
	});

	test("process() applies the transform atomically and returns the new content", async () => {
		const app = makeVault(rootDir, {});
		await app.vault.create("Notes/a.md", "hello");
		const file = app.vault.getFileByPath("Notes/a.md")!;

		const result = await app.vault.process(file, (data) => `${data} world`);
		expect(result).toBe("hello world");
		expect(await app.vault.read(file)).toBe("hello world");
	});

	test("fileManager.trashFile deletes and fires onDelete", async () => {
		const events: string[] = [];
		const vaultEvents: VaultEvents = { onDelete: (p) => events.push(`delete:${p}`) };
		const app = makeVault(rootDir, vaultEvents);
		await app.vault.create("Notes/a.md", "hi");

		await app.fileManager.trashFile(app.vault.getFileByPath("Notes/a.md")!);

		expect(app.vault.getFileByPath("Notes/a.md")).toBeNull();
		expect(fs.existsSync(path.join(rootDir, "Notes/a.md"))).toBe(false);
		expect(events).toEqual(["delete:Notes/a.md"]);
	});

	test("onDelete fires while the entity is still resolvable by path (real Obsidian semantics)", async () => {
		const resolved: { path: string; type: "file" | "folder" | "null" }[] = [];
		const app = makeVault(rootDir, {
			onDelete: (p) => {
				const entity = app.vault.getAbstractFileByPath(p);
				resolved.push({
					path: p,
					type:
						entity instanceof TFile
							? "file"
							: entity instanceof TFolder
								? "folder"
								: "null",
				});
			},
		});
		await app.vault.create("Notes/a.md", "hi");
		await app.vault.createFolder("Notes/sub");

		await app.fileManager.trashFile(app.vault.getFileByPath("Notes/a.md")!);
		await app.fileManager.trashFile(app.vault.getAbstractFileByPath("Notes/sub") as TFolder);

		expect(resolved).toEqual([
			{ path: "Notes/a.md", type: "file" },
			{ path: "Notes/sub", type: "folder" },
		]);
	});

	test("fires onCreate, onModify, onRename at the right times", async () => {
		const events: string[] = [];
		const vaultEvents: VaultEvents = {
			onCreate: (p) => events.push(`create:${p}`),
			onModify: (p) => events.push(`modify:${p}`),
			onRename: (o, n) => events.push(`rename:${o}->${n}`),
		};
		const app = makeVault(rootDir, vaultEvents);

		await app.vault.create("Notes/a.md", "hi");
		await app.vault.modify(app.vault.getFileByPath("Notes/a.md")!, "bye");
		await app.vault.process(app.vault.getFileByPath("Notes/a.md")!, (d) => `${d}!`);
		await app.vault.rename(app.vault.getFileByPath("Notes/a.md")!, "Notes/b.md");

		expect(events).toEqual([
			"create:Notes/a.md",
			"modify:Notes/a.md",
			"modify:Notes/a.md",
			"rename:Notes/a.md->Notes/b.md",
		]);
	});

	test("workspace stubs are no-ops that structurally match mockApp", () => {
		const app = makeVault(rootDir, {});
		expect(app.workspace.getActiveViewOfType(TFile as any)).toBeNull();
		expect(() => app.workspace.openLinkText("Notes/a.md", "")).not.toThrow();
		expect(app.vault.configDir).toBe(".obsidian");
		expect(typeof app.vault.getName()).toBe("string");
	});
});

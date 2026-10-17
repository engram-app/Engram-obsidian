/**
 * Tests for the persisted ExplicitFolders set.
 */
import { describe, expect, test } from "bun:test";
import { ExplicitFolders } from "../src/explicit-folders";

class MemoryAdapter {
	files = new Map<string, string>();
	read(path: string): Promise<string> {
		if (!this.files.has(path)) return Promise.reject(new Error("ENOENT"));
		return Promise.resolve(this.files.get(path) as string);
	}
	write(path: string, data: string): Promise<void> {
		this.files.set(path, data);
		return Promise.resolve();
	}
}

describe("ExplicitFolders", () => {
	test("starts empty", async () => {
		const store = new ExplicitFolders(new MemoryAdapter(), "explicit-folders.json");
		await store.load();
		expect(store.has("anything")).toBe(false);
		expect(store.all()).toEqual([]);
	});

	test("add + persist + reload round-trips", async () => {
		const adapter = new MemoryAdapter();
		const store = new ExplicitFolders(adapter, "explicit-folders.json");
		await store.load();
		await store.add("Projects/Active");
		await store.add("Inbox");

		const fresh = new ExplicitFolders(adapter, "explicit-folders.json");
		await fresh.load();
		expect(fresh.all().sort()).toEqual(["Inbox", "Projects/Active"]);
		expect(fresh.has("Inbox")).toBe(true);
		expect(fresh.has("Projects/Active")).toBe(true);
	});

	test("delete removes a single entry and persists", async () => {
		const adapter = new MemoryAdapter();
		const store = new ExplicitFolders(adapter, "f.json");
		await store.load();
		await store.add("A");
		await store.add("B");
		await store.delete("A");
		expect(store.all().sort()).toEqual(["B"]);

		const fresh = new ExplicitFolders(adapter, "f.json");
		await fresh.load();
		expect(fresh.all()).toEqual(["B"]);
	});

	test("replaceAll wholesale-replaces the set (used after server poll)", async () => {
		const store = new ExplicitFolders(new MemoryAdapter(), "f.json");
		await store.load();
		await store.add("Stale");
		await store.replaceAll(["Fresh", "Other"]);
		expect(store.all().sort()).toEqual(["Fresh", "Other"]);
		expect(store.has("Stale")).toBe(false);
	});

	test("tolerates malformed JSON by starting empty", async () => {
		const adapter = new MemoryAdapter();
		adapter.files.set("explicit-folders.json", "not json");
		const store = new ExplicitFolders(adapter, "explicit-folders.json");
		await store.load();
		expect(store.all()).toEqual([]);
	});

	test("tolerates missing file by starting empty", async () => {
		const store = new ExplicitFolders(new MemoryAdapter(), "missing.json");
		await store.load();
		expect(store.all()).toEqual([]);
	});

	test("tolerates non-array JSON payload", async () => {
		const adapter = new MemoryAdapter();
		adapter.files.set("f.json", JSON.stringify({ not: "an array" }));
		const store = new ExplicitFolders(adapter, "f.json");
		await store.load();
		expect(store.all()).toEqual([]);
	});

	test("add is idempotent — re-adding doesn't duplicate", async () => {
		const store = new ExplicitFolders(new MemoryAdapter(), "f.json");
		await store.load();
		await store.add("Only");
		await store.add("Only");
		expect(store.all()).toEqual(["Only"]);
	});

	test("a server-renamed folder round-trips through persistence", async () => {
		const adapter = new MemoryAdapter();
		const store = new ExplicitFolders(adapter, "f.json");
		await store.load();
		await store.record([
			["Bad:Name", "BadName"],
			["Plain", "Plain"],
			["%2e%2e", ""],
		]);

		const fresh = new ExplicitFolders(adapter, "f.json");
		await fresh.load();
		expect(fresh.has("Bad:Name")).toBe(true);
		expect(fresh.serverName("Bad:Name")).toBe("BadName");
		expect(fresh.has("%2e%2e")).toBe(true);
		expect(fresh.serverName("%2e%2e")).toBe("");
		expect(fresh.has("Plain")).toBe(true);
		expect(fresh.all().sort()).toEqual(["BadName", "Plain"]);
	});

	test("loads the legacy plain-array format", async () => {
		const adapter = new MemoryAdapter();
		adapter.files.set("f.json", JSON.stringify(["A", "B"]));
		const store = new ExplicitFolders(adapter, "f.json");
		await store.load();
		expect(store.all().sort()).toEqual(["A", "B"]);
	});

	test("replaceAll drops an alias whose server name is gone, keeps refusals", async () => {
		const store = new ExplicitFolders(new MemoryAdapter(), "f.json");
		await store.load();
		await store.record([
			["Bad:Name", "BadName"],
			["%2e%2e", ""],
		]);
		await store.replaceAll([]);
		expect(store.has("Bad:Name")).toBe(false);
		expect(store.has("%2e%2e")).toBe(true);
	});
});

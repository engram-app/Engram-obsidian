import "fake-indexeddb/auto";
import { describe, expect, test } from "bun:test";
import { DiscoveryBaseStore } from "../../src/crdt/discovery-base-store";

describe("DiscoveryBaseStore", () => {
	test("discovery base round-trips under fake-indexeddb", async () => {
		const s = new DiscoveryBaseStore("v-rt");
		expect(await s.get("n1")).toBeNull();
		await s.put("n1", "hello");
		expect(await s.get("n1")).toBe("hello");
		await s.put("n1", "");
		expect(await s.get("n1")).toBe("");
		await s.delete("n1");
		expect(await s.get("n1")).toBeNull();
	});

	test("vaults are isolated and survive a new instance", async () => {
		await new DiscoveryBaseStore("va").put("n1", "A");
		expect(await new DiscoveryBaseStore("vb").get("n1")).toBeNull();
		expect(await new DiscoveryBaseStore("va").get("n1")).toBe("A");
	});
});

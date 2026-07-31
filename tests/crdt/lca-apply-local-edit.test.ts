import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { ProviderRegistry } from "../../src/crdt/provider-registry";

const settle = () => new Promise<void>((r) => setTimeout(r, 20));

interface Opts {
	lca: string | null;
	enabled?: boolean;
	dbPrefix: string;
}

function registryWith({ lca, enabled = true, dbPrefix }: Opts) {
	const dirty: string[] = [];
	const registry = new ProviderRegistry({
		dbPrefix,
		send: () => true,
		onFlushToDisk: () => true,
		lcaFor: () => lca,
		lcaMergeEnabled: () => enabled,
		onDirtyMerge: (id) => dirty.push(id),
	});
	return { registry, dirty };
}

describe("applyLocalEdit with an LCA", () => {
	test("keeps a remote edit that the disk snapshot predates", async () => {
		// The regression the whole change exists for. The doc has remote content
		// the disk read never saw; applying the disk delta relative to the base
		// must not delete it.
		const { registry } = registryWith({ lca: "line one\n", dbPrefix: "lca1" });
		await registry.applyLocalEdit("n1", "line one\nremote\n");
		await settle();

		await registry.applyLocalEdit("n1", "line one\nlocal\n");
		const text = await registry.projectedText("n1");

		expect(text).toContain("remote");
		expect(text).toContain("local");
		await registry.destroyAll();
	});

	test("applies a plain disk edit when the doc has not moved", async () => {
		const { registry } = registryWith({ lca: "base\n", dbPrefix: "lca2" });
		await registry.applyLocalEdit("n2", "base\n");
		await settle();

		await registry.applyLocalEdit("n2", "base\nappended\n");

		expect(await registry.projectedText("n2")).toContain("appended");
		await registry.destroyAll();
	});

	test("falls back to the pre-LCA path when the flag is off", async () => {
		const { registry } = registryWith({
			lca: "line one\n",
			enabled: false,
			dbPrefix: "lca3",
		});
		await registry.applyLocalEdit("n3", "line one\nremote\n");
		await settle();

		// Flag off: the two-way diff forces the doc to equal the disk snapshot, so
		// the remote line is lost. Pinned deliberately — this is the behaviour the
		// flag exists to replace, and it must stay reachable while the flag is off.
		await registry.applyLocalEdit("n3", "line one\nlocal\n");

		expect(await registry.projectedText("n3")).not.toContain("remote");
		await registry.destroyAll();
	});

	test("falls back when no base has been recorded yet", async () => {
		const { registry } = registryWith({ lca: null, dbPrefix: "lca4" });

		await registry.applyLocalEdit("n4", "fresh note\n");

		expect(await registry.projectedText("n4")).toContain("fresh note");
		await registry.destroyAll();
	});

	test("reports a dirty merge instead of writing mangled content", async () => {
		const { registry, dirty } = registryWith({
			lca: "the quick brown fox jumps over the lazy dog",
			dbPrefix: "lca5",
		});
		await registry.applyLocalEdit("n5", "totally unrelated replacement text here");
		await settle();

		await registry.applyLocalEdit("n5", "the SLOW brown fox jumps over the lazy dog");

		expect(dirty).toContain("n5");
		await registry.destroyAll();
	});

	test("an unchanged disk read is a no-op rather than a revert", async () => {
		const { registry } = registryWith({ lca: "base\n", dbPrefix: "lca6" });
		await registry.applyLocalEdit("n6", "base\nremote arrived\n");
		await settle();

		// Disk still says exactly the base. There is no local delta, so the doc
		// must keep the remote content rather than being dragged back.
		await registry.applyLocalEdit("n6", "base\n");

		expect(await registry.projectedText("n6")).toContain("remote arrived");
		await registry.destroyAll();
	});
});

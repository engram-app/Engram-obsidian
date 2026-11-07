import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { ProviderRegistry } from "../../src/crdt/provider-registry";

const settle = () => new Promise<void>((r) => setTimeout(r, 20));

interface Opts {
	lca: string | null;
	dbPrefix: string;
}

function registryWith({ lca, dbPrefix }: Opts) {
	const dirty: string[] = [];
	const copies: string[] = [];
	const writes: string[] = [];
	const registry = new ProviderRegistry({
		dbPrefix,
		send: () => true,
		onFlushToDisk: (_id, content) => {
			writes.push(content);
			return true;
		},
		lcaFor: () => lca,
		onDirtyMerge: (id) => dirty.push(id),
		onMergeConflict: async (_id, diskText) => {
			copies.push(diskText);
			return true;
		},
	});
	return { registry, dirty, copies, writes };
}

describe("applyLocalEdit with an LCA", () => {
	test("same-span edits on both sides are a keep-both conflict, never a silent overwrite", async () => {
		// diff-match-patch's fuzzy patch_apply reported this clean and kept the
		// disk side (the doc's edit dropped). merge3 calls it a conflict: the doc
		// keeps its text, disk's goes to a copy, and the doc is written back.
		const { registry, dirty, copies, writes } = registryWith({
			lca: "one two three\n",
			dbPrefix: "lca-lossy",
		});
		await registry.applyLocalEdit("nl", "one deux three\n");
		await settle();

		const onDisk = await registry.applyLocalEdit("nl", "one TWO three\n");

		expect(await registry.projectedText("nl")).toBe("one deux three\n");
		expect(dirty).toEqual(["nl"]);
		expect(copies).toEqual(["one TWO three\n"]);
		expect(writes).toEqual(["one deux three\n"]);
		expect(onDisk).toBe("one deux three\n");
		await registry.destroyAll();
	});

	test("edits on separate lines merge clean", async () => {
		const { registry, dirty } = registryWith({ lca: "1\n2\n3\n4\n", dbPrefix: "lca-notlossy" });
		await registry.applyLocalEdit("nk", "1\n2\n3\nFOUR\n");
		await settle();

		await registry.applyLocalEdit("nk", "1\nTWO\n3\n4\n");

		expect(await registry.projectedText("nk")).toBe("1\nTWO\n3\nFOUR\n");
		expect(dirty).toEqual([]);
		await registry.destroyAll();
	});

	test("edits on ADJACENT lines merge clean (character-level region re-merge)", async () => {
		const { registry, copies } = registryWith({ lca: "1\n2\n3\n", dbPrefix: "lca-adjacent" });
		await registry.applyLocalEdit("na", "1\n2\nTHREE\n");
		await settle();

		await registry.applyLocalEdit("na", "1\nTWO\n3\n");

		expect(await registry.projectedText("na")).toBe("1\nTWO\nTHREE\n");
		expect(copies).toEqual([]);
		await registry.destroyAll();
	});

	test("write-back skips when disk moved during the ingest (an external write wins)", async () => {
		const { registry, writes } = registryWith({ lca: "a\nb\nc\n", dbPrefix: "lca-race" });
		await registry.applyLocalEdit("nr", "a\nb\nC\n"); // the doc's own edit
		await settle();
		writes.length = 0;

		// Disk read "A\nb\nc", but an external write landed before the write-back.
		const onDisk = await registry.applyLocalEdit(
			"nr",
			"A\nb\nc\n",
			undefined,
			async () => "external\n",
		);

		expect(writes).toEqual([]); // the external write is not clobbered
		expect(onDisk).toBe("A\nb\nc\n"); // what disk held when it was read
		await registry.destroyAll();
	});

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

	test("falls back to the lossy two-way path when there is no base", async () => {
		const { registry } = registryWith({ lca: null, dbPrefix: "lca3" });
		await registry.applyLocalEdit("n3", "line one\nremote\n");
		await settle();

		// No base: the two-way diff forces the doc to equal the disk snapshot, so
		// the remote line is lost. Pinned deliberately — LCA is the default path
		// now, but this one stays reachable for never-synced notes, canvases and
		// dirty merges, and its lossiness is why those cases still carry guards.
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

	test("a history-less doc whose disk equals the base returns the DISK content, not an empty projection", async () => {
		// The caller records fnv1a(returned) as the last-synced baseline hash
		// (sync.ts applyCrdtCreateAck). A fresh doc projects to "", so returning
		// the projection here would record the hash of "" as the baseline for a
		// note that actually has content — which makes isUnchangedSynced false
		// forever after and re-opens the #846 doubling path. The adopt-first gate
		// owns this case and must not be bypassed by the LCA branch.
		const registry = new ProviderRegistry({
			dbPrefix: "lca7",
			send: () => true,
			onFlushToDisk: () => true,
			lcaFor: () => "same content\n",
			isUnchangedSynced: () => true,
		});

		const consumed = await registry.applyLocalEdit("n7", "same content\n");

		expect(consumed).toBe("same content\n");
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

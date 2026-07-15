/**
 * e2e test_83 corruption class ("v3 via Obsidian" converged to "v via
 * Obsidian" on both devices AND the server, 2026-07-14 triage): one logical
 * disk edit must reach the wire as ONE atomic Yjs update, and a disk snapshot
 * that predates a remote merge must never be diffed in (the diff would DELETE
 * the remote ops from the doc, and the deletion propagates everywhere).
 */
import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import * as Y from "yjs";
import { CONTENT_KEY, CrdtManager } from "../../src/crdt/manager";

function makeManager(captured: Uint8Array[] = []) {
	const flushed: Record<string, string> = {};
	const mgr = new CrdtManager({
		dbPrefix: `vault-atomic-${Math.random().toString(36).slice(2)}`,
		onUpdate: (_docId, update) => captured.push(update),
		onFlushToDisk: async (path, content) => {
			flushed[path] = content;
		},
	});
	return { mgr, captured, flushed };
}

describe("applyLocalEdit emits one atomic update per logical edit", () => {
	test("a multi-op body diff plus a frontmatter change is a single update", async () => {
		const { mgr, captured } = makeManager();
		mgr.markSynced("n1");
		await mgr.applyLocalEdit("n1", "alpha beta gamma\n", false);
		captured.length = 0;

		// One logical edit: new frontmatter block + two disjoint body changes.
		// dmp yields several insert/delete ops; pre-fix each op (and the
		// frontmatter transaction) shipped as its own update, so a receiver
		// could observe (and flush to disk) a truncated intermediate state.
		await mgr.applyLocalEdit("n1", "---\ntitle: T\n---\nalpha NEW beta gamma EXTENDED\n", true);

		expect(await mgr.getText("n1")).toBe("alpha NEW beta gamma EXTENDED\n");
		expect(captured.length).toBe(1);
		await mgr.destroy();
	});
});

describe("stale disk snapshot never reverts a remote merge", () => {
	test("a remote update landed after the snapshot survives (reread wins)", async () => {
		const { mgr, captured, flushed } = makeManager();
		mgr.markSynced("n1");
		await mgr.applyLocalEdit("n1", "base\n", false);

		// A second device (same history, replayed from our updates) prepends
		// "REMOTE " and its update is merged into our doc.
		const remote = new Y.Doc();
		for (const u of captured) Y.applyUpdate(remote, u);
		const remoteUpdates: Uint8Array[] = [];
		remote.on("update", (u: Uint8Array) => remoteUpdates.push(u));
		remote.getText(CONTENT_KEY).insert(0, "REMOTE ");
		await mgr.applyRemoteUpdate("n1", remoteUpdates[0]!);
		expect(flushed.n1).toContain("REMOTE");

		// The push pipeline froze "base\n" BEFORE the remote landed (debounce +
		// entry-await gap). Diffing that stale snapshot against the doc would
		// surgically delete "REMOTE " (the observed test_83 corruption). With a
		// reread supplied, the manager must diff current disk state instead.
		await mgr.applyLocalEdit("n1", "base\n", true, async () => flushed.n1 ?? "base\n");

		expect(await mgr.getText("n1")).toBe("REMOTE base\n");
		await mgr.destroy();
	});
});

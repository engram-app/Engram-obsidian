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
import { CONTENT_KEY, CrdtManager, REMOTE_ORIGIN } from "../../src/crdt/manager";

function tick(ms = 5): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

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

	test("a remote merge whose flush is in flight when the guard runs is never reverted (seq captured before the flush await)", async () => {
		// review finding manager.ts:318: capturing remoteSeq AFTER awaiting
		// pendingFlush lets a remote update that lands DURING that await count
		// toward the captured seq while its own disk flush is still in flight —
		// the stability check then passes on a reread that predates the merge and
		// the diff deletes the just-merged ops.
		const flushed: Record<string, string> = {};
		const gates: Array<() => void> = [];
		const captured: Uint8Array[] = [];
		const mgr = new CrdtManager({
			dbPrefix: `vault-seq-${Math.random().toString(36).slice(2)}`,
			onUpdate: (_d, u) => captured.push(u),
			onFlushToDisk: (path, content) =>
				new Promise<void>((resolve) => {
					gates.push(() => {
						flushed[path] = content;
						resolve();
					});
				}),
		});
		mgr.markSynced("n1");
		await mgr.applyLocalEdit("n1", "base\n", false);

		const remote = new Y.Doc();
		for (const u of captured) Y.applyUpdate(remote, u);
		const remoteUpdates: Uint8Array[] = [];
		remote.on("update", (u: Uint8Array) => remoteUpdates.push(u));
		remote.getText(CONTENT_KEY).insert(0, "R1 ");
		remote.getText(CONTENT_KEY).insert(0, "R2 ");

		// Room-path delivery (crdt/channel readSyncMessage): raw apply with
		// REMOTE_ORIGIN — no applyRemoteUpdate, so nothing consumes pendingFlush.
		const doc = await mgr.getDoc("n1");
		Y.applyUpdate(doc, remoteUpdates[0]!, REMOTE_ORIGIN); // R1: flush gated
		const edit = mgr.applyLocalEdit("n1", "base\n", true, async () => flushed.n1 ?? "base\n");
		await tick(); // guard is awaiting R1's gated flush
		Y.applyUpdate(doc, remoteUpdates[1]!, REMOTE_ORIGIN); // R2 lands mid-await
		gates[0]?.(); // R1 flush completes — disk holds "R1 base\n", NOT R2
		await tick();
		gates[1]?.(); // R2 flush completes
		await tick();
		gates[2]?.(); // any retry-window flush
		await edit;

		expect(await mgr.getText("n1")).toBe("R2 R1 base\n");
		await mgr.destroy();
	});

	test("one rejected room-path disk flush does not poison later local edits", async () => {
		// review finding manager.ts:317: room-path updates record a pendingFlush
		// entry nobody consumes; a single rejection must not make every later
		// applyLocalEdit for that note rethrow a long-past disk error.
		const captured: Uint8Array[] = [];
		let failNext = true;
		const flushed: Record<string, string> = {};
		const mgr = new CrdtManager({
			dbPrefix: `vault-poison-${Math.random().toString(36).slice(2)}`,
			onUpdate: (_d, u) => captured.push(u),
			onFlushToDisk: async (path, content) => {
				if (failNext) {
					failNext = false;
					throw new Error("disk full");
				}
				flushed[path] = content;
			},
		});
		mgr.markSynced("n1");
		await mgr.applyLocalEdit("n1", "base\n", false);

		const remote = new Y.Doc();
		for (const u of captured) Y.applyUpdate(remote, u);
		const remoteUpdates: Uint8Array[] = [];
		remote.on("update", (u: Uint8Array) => remoteUpdates.push(u));
		remote.getText(CONTENT_KEY).insert(0, "R1 ");
		const doc = await mgr.getDoc("n1");
		Y.applyUpdate(doc, remoteUpdates[0]!, REMOTE_ORIGIN); // flush rejects
		await tick();

		const consumed = await mgr.applyLocalEdit(
			"n1",
			"R1 base EDIT\n",
			true,
			async () => "R1 base EDIT\n",
		);
		expect(consumed).not.toBeNull();
		expect(await mgr.getText("n1")).toContain("EDIT");
		await mgr.destroy();
	});

	test("a persistent remote-merge storm gives up NOT-consumed and leaves the doc untouched", async () => {
		// review finding manager.ts:322: the give-up path returned true
		// ("consumed") for an edit that was never applied — pushFile then stamped
		// a stale echo baseline and logged success, silently losing the edit.
		// Give-up must report NOT consumed so the REST fallback owns the edit.
		const captured: Uint8Array[] = [];
		const flushed: Record<string, string> = {};
		const mgr = new CrdtManager({
			dbPrefix: `vault-storm-${Math.random().toString(36).slice(2)}`,
			onUpdate: (_d, u) => captured.push(u),
			onFlushToDisk: async (path, content) => {
				flushed[path] = content;
			},
		});
		mgr.markSynced("n1");
		await mgr.applyLocalEdit("n1", "base\n", false);

		const remote = new Y.Doc();
		for (const u of captured) Y.applyUpdate(remote, u);
		const remoteUpdates: Uint8Array[] = [];
		remote.on("update", (u: Uint8Array) => remoteUpdates.push(u));
		const doc = await mgr.getDoc("n1");
		let i = 0;
		const reread = async () => {
			// Every reread races a fresh remote merge (live storm).
			remote.getText(CONTENT_KEY).insert(0, `R${i} `);
			Y.applyUpdate(doc, remoteUpdates[i]!, REMOTE_ORIGIN);
			i++;
			return "base LOCAL\n";
		};

		const res = await mgr.applyLocalEdit("n1", "base LOCAL\n", true, reread);
		expect(res).toBeNull();
		expect(await mgr.getText("n1")).not.toContain("LOCAL");
		await mgr.destroy();
	});

	test("a reread failure (cap exceeded / unreadable) is NOT consumed", async () => {
		// review finding sync.ts:2099: routeModify's reread enforces the CRDT
		// size cap by throwing; the manager must translate any reread failure
		// into not-consumed (REST owns the edit), never into a stale diff.
		const { mgr } = makeManager();
		mgr.markSynced("n1");
		await mgr.applyLocalEdit("n1", "base\n", false);
		const res = await mgr.applyLocalEdit("n1", "base grown\n", true, async () => {
			throw new Error("exceeds MAX_CRDT_NOTE_BYTES");
		});
		expect(res).toBeNull();
		expect(await mgr.getText("n1")).toBe("base\n");
		await mgr.destroy();
	});
});

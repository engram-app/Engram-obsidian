/**
 * e2e test_83 corruption class ("v3 via Obsidian" converged to "v via
 * Obsidian" on both devices AND the server, 2026-07-14 triage): one logical
 * disk edit must reach the wire as ONE atomic Yjs update, and a disk snapshot
 * that predates a remote merge must never be diffed in (the diff would DELETE
 * the remote ops from the doc, and the deletion propagates everywhere).
 *
 * Ported to the Relay-model ProviderRegistry (the stale-snapshot guard lives in
 * ProviderRegistry.applyLocalEdit now). The "room path" — a remote merge that
 * arrives over readSyncMessage and is NOT consumed by an applyRemoteUpdate
 * caller — is driven here via `receive(encodeUpdateFrame(update))`, the exact
 * inbound path the provider uses; the vault-fan-out path stays applyRemoteUpdate.
 */
import { describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import * as Y from "yjs";
import { CONTENT_KEY } from "../../src/crdt/frontmatter-codec";
import { ProviderRegistry } from "../../src/crdt/provider-registry";
import { encodeUpdateFrame } from "../../src/crdt/wire";

function tick(ms = 5): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function makeManager(opts?: {
	onFlushToDisk?: (path: string, content: string) => Promise<void> | void;
}) {
	const flushed: Record<string, string> = {};
	const mgr = new ProviderRegistry({
		dbPrefix: `vault-atomic-${Math.random().toString(36).slice(2)}`,
		// Relay: the provider owns its own outbound send; the old onUpdate capture
		// is replaced by a doc.on("update") listener per test where a count matters.
		send: () => true,
		onFlushToDisk:
			opts?.onFlushToDisk ??
			(async (path, content) => {
				flushed[path] = content;
			}),
	});
	return { mgr, flushed };
}

/** Build a second "device" doc sharing this note's lineage (replayed from the
 *  registry doc's current state), so its updates merge cleanly. */
async function remoteFrom(mgr: ProviderRegistry, noteId: string) {
	const remote = new Y.Doc();
	Y.applyUpdate(remote, Y.encodeStateAsUpdate(await mgr.getDoc(noteId)));
	const updates: Uint8Array[] = [];
	remote.on("update", (u: Uint8Array) => updates.push(u));
	return { remote, updates };
}

describe("applyLocalEdit emits one atomic update per logical edit", () => {
	test("a multi-op body diff plus a frontmatter change is a single update", async () => {
		const { mgr } = makeManager();
		mgr.markSynced("n1");
		await mgr.applyLocalEdit("n1", "alpha beta gamma\n", false);

		// One logical edit: new frontmatter block + two disjoint body changes.
		// dmp yields several insert/delete ops; the seed codec must wrap them (and
		// the frontmatter transaction) in ONE Yjs transaction, so a receiver never
		// observes (and flushes to disk) a truncated intermediate state.
		const doc = await mgr.getDoc("n1");
		let count = 0;
		doc.on("update", () => {
			count++;
		});
		await mgr.applyLocalEdit("n1", "---\ntitle: T\n---\nalpha NEW beta gamma EXTENDED\n", true);

		expect(await mgr.getText("n1")).toBe("alpha NEW beta gamma EXTENDED\n");
		expect(count).toBe(1);
		await mgr.destroyAll();
	});
});

describe("stale disk snapshot never reverts a remote merge", () => {
	test("a remote update landed after the snapshot survives (reread wins)", async () => {
		const { mgr, flushed } = makeManager();
		mgr.markSynced("n1");
		await mgr.applyLocalEdit("n1", "base\n", false);

		// A second device (same history) prepends "REMOTE " and its update is
		// merged into our doc via the vault-fan-out path (applyRemoteUpdate).
		const { remote, updates } = await remoteFrom(mgr, "n1");
		remote.getText(CONTENT_KEY).insert(0, "REMOTE ");
		await mgr.applyRemoteUpdate("n1", updates[0]!);
		expect(flushed.n1).toContain("REMOTE");

		// The push pipeline froze "base\n" BEFORE the remote landed (debounce +
		// entry-await gap). Diffing that stale snapshot against the doc would
		// surgically delete "REMOTE " (the observed test_83 corruption). With a
		// reread supplied, the manager must diff current disk state instead.
		await mgr.applyLocalEdit("n1", "base\n", true, async () => flushed.n1 ?? "base\n");

		expect(await mgr.getText("n1")).toBe("REMOTE base\n");
		await mgr.destroyAll();
	});

	test("a remote merge whose flush is in flight when the guard runs is never reverted (seq captured before the flush await)", async () => {
		// Capturing remoteSeq AFTER awaiting pendingFlush lets a remote update that
		// lands DURING that await count toward the captured seq while its own disk
		// flush is still in flight — the stability check then passes on a reread
		// that predates the merge and the diff deletes the just-merged ops.
		const flushed: Record<string, string> = {};
		const gates: Array<() => void> = [];
		const { mgr } = makeManager({
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

		const { remote, updates } = await remoteFrom(mgr, "n1");
		remote.getText(CONTENT_KEY).insert(0, "R1 ");
		remote.getText(CONTENT_KEY).insert(0, "R2 ");

		// Room-path delivery (readSyncMessage): a frame received by the provider,
		// no applyRemoteUpdate — so nothing external consumes pendingFlush.
		await mgr.receive("n1", encodeUpdateFrame(updates[0]!)); // R1: flush gated
		const edit = mgr.applyLocalEdit("n1", "base\n", true, async () => flushed.n1 ?? "base\n");
		await tick(); // guard is awaiting R1's gated flush
		await mgr.receive("n1", encodeUpdateFrame(updates[1]!)); // R2 lands mid-await
		gates[0]?.(); // R1 flush completes — disk holds "R1 base\n", NOT R2
		await tick();
		gates[1]?.(); // R2 flush completes
		await tick();
		gates[2]?.(); // any retry-window flush
		await edit;

		expect(await mgr.getText("n1")).toBe("R2 R1 base\n");
		await mgr.destroyAll();
	});

	test("one rejected room-path disk flush does not poison later local edits", async () => {
		// Room-path updates record a pendingFlush entry nobody consumes; a single
		// rejection must not make every later applyLocalEdit for that note rethrow
		// a long-past disk error.
		let failNext = true;
		const flushed: Record<string, string> = {};
		const { mgr } = makeManager({
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

		const { remote, updates } = await remoteFrom(mgr, "n1");
		remote.getText(CONTENT_KEY).insert(0, "R1 ");
		await mgr.receive("n1", encodeUpdateFrame(updates[0]!)); // flush rejects
		await tick();

		const consumed = await mgr.applyLocalEdit(
			"n1",
			"R1 base EDIT\n",
			true,
			async () => "R1 base EDIT\n",
		);
		expect(consumed).not.toBeNull();
		expect(await mgr.getText("n1")).toContain("EDIT");
		await mgr.destroyAll();
	});

	test("a persistent remote-merge storm gives up NOT-consumed and leaves the doc untouched", async () => {
		// The give-up path must report NOT consumed for an edit that was never
		// applied — else pushFile stamps a stale echo baseline and logs success,
		// silently losing the edit. Give-up returns null so REST owns the edit.
		const { mgr } = makeManager();
		mgr.markSynced("n1");
		await mgr.applyLocalEdit("n1", "base\n", false);

		const { remote, updates } = await remoteFrom(mgr, "n1");
		let i = 0;
		const reread = async () => {
			// Every reread races a fresh remote merge (live storm).
			remote.getText(CONTENT_KEY).insert(0, `R${i} `);
			await mgr.receive("n1", encodeUpdateFrame(updates[i]!));
			i++;
			return "base LOCAL\n";
		};

		const res = await mgr.applyLocalEdit("n1", "base LOCAL\n", true, reread);
		expect(res).toBeNull();
		expect(await mgr.getText("n1")).not.toContain("LOCAL");
		await mgr.destroyAll();
	});

	test("a reread failure (cap exceeded / unreadable) is NOT consumed", async () => {
		// routeModify's reread enforces the CRDT size cap by throwing; the manager
		// must translate any reread failure into not-consumed (REST owns the edit),
		// never into a stale diff.
		const { mgr } = makeManager();
		mgr.markSynced("n1");
		await mgr.applyLocalEdit("n1", "base\n", false);
		const res = await mgr.applyLocalEdit("n1", "base grown\n", true, async () => {
			throw new Error("exceeds MAX_CRDT_NOTE_BYTES");
		});
		expect(res).toBeNull();
		expect(await mgr.getText("n1")).toBe("base\n");
		await mgr.destroyAll();
	});
});

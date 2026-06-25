import { expect, test } from "bun:test";
import "fake-indexeddb/auto";
import * as Y from "yjs";
import { CrdtManager } from "../../src/crdt/manager";

function makeManager(captured: Uint8Array[] = []) {
	const flushed: Record<string, string> = {};
	const mgr = new CrdtManager({
		dbPrefix: "vault-A",
		onUpdate: (_docId, update) => captured.push(update),
		onFlushToDisk: async (path, content) => {
			flushed[path] = content;
		},
	});
	return { mgr, captured, flushed };
}

test("applyLocalEdit seeds a fresh doc once then diffs subsequent edits", async () => {
	const { mgr } = makeManager();
	await mgr.applyLocalEdit("note.md", "first body", false);
	expect(await mgr.getText("note.md")).toBe("first body");

	// Subsequent edit: hasLca true (history exists) → must diff, not re-seed.
	await mgr.applyLocalEdit("note.md", "first body, extended", true);
	expect(await mgr.getText("note.md")).toBe("first body, extended");
	await mgr.destroy();
});

test("local edits emit a v1 update via onUpdate", async () => {
	const captured: Uint8Array[] = [];
	const { mgr } = makeManager(captured);
	await mgr.applyLocalEdit("note.md", "hello", false);
	expect(captured.length).toBeGreaterThan(0);

	// The captured update applies cleanly into a fresh doc (valid v1 codec).
	const dst = new Y.Doc();
	for (const u of captured) Y.applyUpdate(dst, u);
	expect(dst.getText("content").toString()).toBe("hello");
	await mgr.destroy();
});

test("applyRemoteUpdate flushes merged text to disk", async () => {
	const { mgr, flushed } = makeManager();
	await mgr.applyLocalEdit("note.md", "base", false);

	// Build a remote update on top of the same state.
	const peer = new Y.Doc();
	Y.applyUpdate(peer, await mgr.encodeStateAsUpdate("note.md"));
	peer.getText("content").insert(peer.getText("content").length, " + remote");
	const remoteUpdate = Y.encodeStateAsUpdate(peer, await mgr.encodeStateVector("note.md"));

	await mgr.applyRemoteUpdate("note.md", remoteUpdate);
	expect(flushed["note.md"]).toBe("base + remote");
	await mgr.destroy();
});

test("state persists to IndexedDB across a manager restart", async () => {
	const a = makeManager();
	await a.mgr.applyLocalEdit("note.md", "survives reload", false);
	await new Promise((r) => setTimeout(r, 50)); // let y-indexeddb flush
	await a.mgr.destroy();

	const b = makeManager();
	// getDoc must rehydrate from IndexedDB under the same docId.
	expect(await b.mgr.getText("note.md")).toBe("survives reload");
	await b.mgr.destroy();
});

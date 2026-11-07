import { expect, test } from "bun:test";
import "fake-indexeddb/auto";
import * as Y from "yjs";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { ProviderRegistry } from "../src/crdt/provider-registry";

const settle = () => new Promise<void>((r) => setTimeout(r, 30));

test("a merge write-back records its frontmatter: the next body-only flush reports no block change", async () => {
	const flushes: { content: string; fmChanged: boolean }[] = [];
	const writes: string[] = [];
	const reg = new ProviderRegistry({
		dbPrefix: "zz-fm",
		send: () => true,
		onFlushToDisk: (_id, content, fmChanged) => {
			flushes.push({ content, fmChanged });
			return true;
		},
		// Mirrors `SyncEngine.writeNoteIfDiskStill`: a landed write marks the doc written.
		writeIfDiskStill: async (id: string, _e: string, text: string) => {
			writes.push(text);
			reg.markWritten(id);
			return text;
		},
	} as any);
	const ID = "n1";
	const A = "---\ntitle: a\n---\nbody\nline2\n";
	// remote genesis, flushed (lastFlushedFm = title: a)
	await reg.applyRemoteUpdate(ID, reg.encodeGenesisUpdate(A));
	await settle();
	// remote body edit the disk never got
	const peer = new Y.Doc();
	Y.applyUpdate(peer, Y.encodeStateAsUpdate(await reg.getDoc(ID)));
	let sv = Y.encodeStateVector(peer);
	const t = peer.getText(CONTENT_KEY);
	t.insert(t.toJSON().indexOf("line2"), "remote ");
	// pretend that flush failed: disk keeps A; base = A
	await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(peer, sv));
	await settle();
	(reg as any).setMergeBase(ID, A);
	// user changes frontmatter on disk (from A) -> merge -> write-back writes new fm
	const disk = "---\ntitle: b\n---\nbody\nline2\n";
	await reg.applyLocalEdit(ID, disk, undefined, async () => disk);
	await settle();
	expect(writes.length).toBe(1);
	// now a remote BODY-only edit
	Y.applyUpdate(peer, Y.encodeStateAsUpdate(await reg.getDoc(ID)));
	sv = Y.encodeStateVector(peer);
	t.insert(t.toJSON().length, "tail\n");
	const before = flushes.length;
	await reg.applyRemoteUpdate(ID, Y.encodeStateAsUpdate(peer, sv));
	await settle();
	expect(flushes.length).toBe(before + 1);
	const last = flushes[flushes.length - 1];
	expect(last.fmChanged).toBe(false); // the block has not changed since the last disk write
	await reg.destroyAll();
});

/**
 * First sync of notes whose frontmatter the codec re-serialises must not
 * drift-copy them (Engram#1928 class, backend e2e test_101), now that a flush
 * keeps disk's own frontmatter bytes when they mean the same (PR 683). Every
 * create-ack path must stamp what disk HOLDS as the baseline, never the bare
 * projection: a baseline no file holds makes the next catch-up read the note
 * as locally edited and drift-copy it.
 */
import { expect, test } from "bun:test";
import * as Y from "yjs";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { FM_SHAPES, fmDevice } from "./helpers/first-sync-fm";

/** A peer's edit of `from` -> `to`, applied to the device's doc as a remote update. */
async function remoteEdit(d: ReturnType<typeof fmDevice>, from: string, to: string) {
	const peer = new Y.Doc();
	Y.applyUpdate(peer, Y.encodeStateAsUpdate(await d.reg.getDoc(d.ID)));
	const sv = Y.encodeStateVector(peer);
	const t = peer.getText(CONTENT_KEY);
	const at = t.toJSON().indexOf(from);
	peer.transact(() => {
		t.delete(at, from.length);
		t.insert(at, to);
	});
	await d.reg.applyRemoteUpdate(d.ID, Y.encodeStateAsUpdate(peer, sv));
}

for (const [name, fm] of Object.entries(FM_SHAPES)) {
	const raw = `${fm}body of ${name}\nsecond line\n`;

	test(`stored genesis of "${name}": baseline is what disk holds`, async () => {
		const d = fmDevice(name, raw);
		try {
			const consumed = await d.engine.seedBodyAfterCreate({
				effectiveId: d.ID,
				normalized: d.PATH,
				file: d.file,
				seeded: true,
				sameId: true,
				genesisOutcome: "stored",
				genesisUpdate: d.reg.encodeGenesisUpdate(raw),
				genesisContent: raw,
			});
			await d.engine.adoptCreateAck(d.ID, d.PATH, consumed, { flushHeld: false });
			const { now, synced } = d.diskSynced();
			expect(now).toBe(raw); // equal by meaning: the user's bytes are kept
			expect(synced).toBe(true);
		} finally {
			await d.reg.destroyAll();
		}
	});

	test(`stored genesis of "${name}" with an edit during the create: merges, baseline is disk`, async () => {
		const edited = `${raw}edited during the create\n`;
		const d = fmDevice(name, edited);
		try {
			const consumed = await d.engine.seedBodyAfterCreate({
				effectiveId: d.ID,
				normalized: d.PATH,
				file: d.file,
				seeded: true,
				sameId: true,
				genesisOutcome: "stored",
				genesisUpdate: d.reg.encodeGenesisUpdate(raw),
				genesisContent: raw,
			});
			await d.engine.adoptCreateAck(d.ID, d.PATH, consumed, { flushHeld: false });
			expect(d.copies).toEqual([]); // no conflict copy
			expect(await d.reg.projectedText(d.ID)).toContain("edited during the create");
			const { now, synced } = d.diskSynced();
			expect(now).toContain("edited during the create");
			expect(consumed).toBe(now); // the merge's write is the baseline
			expect(synced).toBe(true);
		} finally {
			await d.reg.destroyAll();
		}
	});

	// The occupied re-sent create under our own id: this device already holds
	// the lineage (an earlier create of it that landed).
	const occupied = (d: ReturnType<typeof fmDevice>) =>
		d.engine.seedBodyAfterCreate({
			effectiveId: d.ID,
			normalized: d.PATH,
			file: d.file,
			seeded: false,
			sameId: true,
			genesisOutcome: "occupied",
			genesisUpdate: undefined,
			genesisContent: undefined,
		});

	test(`occupied own-base create of "${name}" with a disk edit: merges, baseline is disk`, async () => {
		const d = fmDevice(name, raw);
		try {
			await d.reg.applyRemoteUpdate(d.ID, d.reg.encodeGenesisUpdate(raw));
			await remoteEdit(d, "second line", "second line, server edit"); // flushed to disk
			d.engine.ownGenesis.set(d.ID, raw);
			d.engine.readServerDocState = async () => null;
			d.disk.set(d.PATH, `${raw}local edit\n`); // disk moved off what we sent
			const consumed = await occupied(d);
			await d.engine.adoptCreateAck(d.ID, d.PATH, consumed, { flushHeld: false });
			const doc = await d.reg.projectedText(d.ID);
			expect(doc).toContain("server edit");
			expect(doc).toContain("local edit");
			const { now, synced } = d.diskSynced();
			expect(now).toContain("server edit"); // disk got the merge
			expect(now).toContain("local edit");
			expect(now.startsWith(fm)).toBe(true); // and kept the user's YAML
			expect(synced).toBe(true);
		} finally {
			await d.reg.destroyAll();
		}
	});

	test(`occupied own-base create of "${name}" with an overlapping disk edit: copy, baseline is disk`, async () => {
		const d = fmDevice(name, raw);
		try {
			await d.reg.applyRemoteUpdate(d.ID, d.reg.encodeGenesisUpdate(raw));
			await remoteEdit(d, "second line", "server version");
			d.engine.ownGenesis.set(d.ID, raw);
			d.engine.readServerDocState = async () => null;
			const local = raw.replace("second line", "local version");
			d.disk.set(d.PATH, local); // the same line: the merge is refused
			const consumed = await occupied(d);
			await d.engine.adoptCreateAck(d.ID, d.PATH, consumed, { flushHeld: false });
			expect(d.copies).toEqual([local]); // disk's edit kept as a copy
			const { now, synced } = d.diskSynced();
			expect(now).toContain("server version"); // disk converged to the doc
			expect(now.startsWith(fm)).toBe(true);
			expect(synced).toBe(true);
		} finally {
			await d.reg.destroyAll();
		}
	});
}

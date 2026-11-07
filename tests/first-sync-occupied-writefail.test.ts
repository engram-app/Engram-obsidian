import { expect, test } from "bun:test";
import * as Y from "yjs";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { fmDevice } from "./helpers/first-sync-fm";

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

test("occupied own-base merged: a failed disk write must not stamp a baseline disk lacks", async () => {
	const raw = "---\ntitle: x\n---\nbody\nsecond line\n";
	const d = fmDevice("writefail", raw);
	try {
		await d.reg.applyRemoteUpdate(d.ID, d.reg.encodeGenesisUpdate(raw));
		await remoteEdit(d, "second line", "second line, server edit");
		d.engine.ownGenesis.set(d.ID, raw);
		d.engine.readServerDocState = async () => null;
		const local = `${raw}local edit\n`;
		d.disk.set(d.PATH, local);
		d.engine.app.vault.modify = async () => {
			throw new Error("EACCES");
		};
		const consumed = await d.engine.seedBodyAfterCreate({
			effectiveId: d.ID,
			normalized: d.PATH,
			file: d.file,
			seeded: false,
			sameId: true,
			genesisOutcome: "occupied",
			genesisUpdate: undefined,
			genesisContent: undefined,
		});
		expect(consumed).toBe(d.disk.get(d.PATH));
	} finally {
		await d.reg.destroyAll();
	}
});

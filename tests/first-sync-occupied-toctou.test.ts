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

for (const refused of [false, true]) {
	test(`occupied own-base: an edit landing during the merge is not overwritten (refused=${refused})`, async () => {
		const raw = "---\ntitle: x\n---\nbody\nsecond line\n";
		const d = fmDevice(`toctou-${refused}`, raw);
		try {
			await d.reg.applyRemoteUpdate(d.ID, d.reg.encodeGenesisUpdate(raw));
			await remoteEdit(
				d,
				"second line",
				refused ? "server version" : "second line, server edit",
			);
			d.engine.ownGenesis.set(d.ID, raw);
			d.engine.readServerDocState = async () => null;
			d.disk.set(
				d.PATH,
				refused ? raw.replace("second line", "local version") : `${raw}local edit\n`,
			);
			const orig = d.reg.mergeLocalEditFromBase.bind(d.reg);
			d.reg.mergeLocalEditFromBase = async (...a: any[]) => {
				const out = await (orig as any)(...a);
				// the user types again while the merge runs
				d.disk.set(d.PATH, `${d.disk.get(d.PATH)}TYPED DURING MERGE\n`);
				return out;
			};
			await d.engine.seedBodyAfterCreate({
				effectiveId: d.ID,
				normalized: d.PATH,
				file: d.file,
				seeded: false,
				sameId: true,
				genesisOutcome: "occupied",
				genesisUpdate: undefined,
				genesisContent: undefined,
			});
			const kept = [
				d.disk.get(d.PATH) ?? "",
				...d.copies,
				await d.reg.projectedText(d.ID),
			].join("\n");
			expect(kept).toContain("TYPED DURING MERGE");
		} finally {
			await d.reg.destroyAll();
		}
	});
}

test("stored create: an edit landing during the create-drift merge is not overwritten", async () => {
	const raw = "---\ntitle: x\n---\nbody\nsecond line\n";
	const d = fmDevice("toctou-stored", `${raw}edited during the create\n`);
	try {
		const orig = d.reg.mergeLocalEditFromBase.bind(d.reg);
		d.reg.mergeLocalEditFromBase = async (...a: any[]) => {
			const out = await (orig as any)(...a);
			d.disk.set(d.PATH, `${d.disk.get(d.PATH)}TYPED DURING MERGE\n`);
			return out;
		};
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
		expect(d.disk.get(d.PATH)).toContain("TYPED DURING MERGE"); // not overwritten
		expect(consumed).not.toContain("TYPED DURING MERGE"); // baseline: disk before it
	} finally {
		await d.reg.destroyAll();
	}
});

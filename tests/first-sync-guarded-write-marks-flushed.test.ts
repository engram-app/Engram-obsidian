import { expect, test } from "bun:test";
import * as Y from "yjs";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { fmDevice } from "./helpers/first-sync-fm";

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const raw = "---\ntitle: x\n---\nbody\nsecond line\nthird\n";
const SERVER = "second line, server edit";

async function ingest(d: ReturnType<typeof fmDevice>) {
	const reread = () => d.engine.app.vault.cachedRead(d.file);
	const consumed = await d.reg.applyLocalEdit(d.ID, d.disk.get(d.PATH)!, undefined, reread);
	if (consumed !== null) d.engine.recordCrdtBaseline(d.PATH, consumed);
	await tick();
}

// Stored create, no drift: a catch-up edit landed in the doc before the
// genesis apply, and the apply's flush fails. Baseline must be what disk holds,
// and a later user edit must keep the server edit.
test("stored create, history before the ack and a failed flush: stamps disk, keeps the server edit", async () => {
	const d = fmDevice("cde-stored-flushfail", raw);
	try {
		const peer = new Y.Doc();
		Y.applyUpdate(peer, d.reg.encodeGenesisUpdate(raw));
		const t = peer.getText(CONTENT_KEY);
		const at = t.toJSON().indexOf("second line");
		peer.transact(() => {
			t.delete(at, "second line".length);
			t.insert(at, SERVER);
		});
		d.engine.ownGenesis.set(d.ID, raw);
		const realModify = d.engine.app.vault.modify;
		d.engine.app.vault.modify = async () => {
			throw new Error("EACCES");
		};
		await d.reg.applyRemoteUpdate(d.ID, Y.encodeStateAsUpdate(peer)).catch(() => {});
		await tick();
		const consumed = await d.engine
			.seedBodyAfterCreate({
				effectiveId: d.ID,
				normalized: d.PATH,
				file: d.file,
				seeded: true,
				sameId: true,
				genesisOutcome: "stored",
				genesisUpdate: d.reg.encodeGenesisUpdate(raw),
				genesisContent: raw,
			})
			.catch((e: unknown) => `THREW ${e}`);
		d.engine.app.vault.modify = realModify;
		expect(consumed).toBe(d.disk.get(d.PATH));
		d.engine.recordCrdtBaseline(d.PATH, consumed, { markCreated: true });
		d.disk.set(d.PATH, d.disk.get(d.PATH)!.replace("third", "third, user later"));
		await ingest(d);
		const doc = await d.reg.projectedText(d.ID);
		expect(doc).toContain(SERVER);
		expect(doc).toContain("user later");
		expect(d.disk.get(d.PATH)).toBe(doc);
	} finally {
		await d.reg.destroyAll();
	}
});

// The engine's guarded write must mark the registry written (not only the
// registry-level fake in crdt-write-back-flushed-frontmatter).
test("writeNoteIfDiskStill marks the doc written on a landed write only", async () => {
	const d = fmDevice("cde-markwritten", raw);
	try {
		await d.reg.applyRemoteUpdate(d.ID, d.reg.encodeGenesisUpdate(raw));
		await tick();
		const calls: string[] = [];
		const orig = d.reg.markWritten.bind(d.reg);
		d.reg.markWritten = (id: string) => {
			calls.push(id);
			orig(id);
		};
		const disk = d.disk.get(d.PATH)!;
		await d.engine.writeNoteIfDiskStill(d.PATH, `${disk}moved`, `${disk}x\n`);
		expect(calls).toEqual([]);
		// a write landing must mark
		await d.reg.applyLocalEdit(d.ID, `${disk}x\n`);
		d.disk.set(d.PATH, disk);
		const w = await d.engine.writeNoteIfDiskStill(d.PATH, disk, `${disk}x\n`);
		expect(w).not.toBeNull();
		expect(calls).toEqual([d.ID]);
	} finally {
		await d.reg.destroyAll();
	}
});

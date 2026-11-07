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
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const raw = "---\ntitle: x\n---\nbody\nsecond line\nthird\n";
const SERVER = "second line, server edit";

async function occupied(mode: "fail" | "moved", name: string) {
	const d = fmDevice(name, raw);
	await d.reg.applyRemoteUpdate(d.ID, d.reg.encodeGenesisUpdate(raw));
	await remoteEdit(d, "second line", SERVER);
	d.engine.ownGenesis.set(d.ID, raw);
	d.engine.readServerDocState = async () => null;
	d.disk.set(d.PATH, `${raw}local edit\n`);
	const realModify = d.engine.app.vault.modify;
	if (mode === "fail") {
		let n = 0;
		d.engine.app.vault.modify = async (...a: any[]) => {
			if (n++ === 0) throw new Error("EACCES");
			return realModify(...a);
		};
	} else {
		const orig = d.reg.mergeLocalEditFromBase.bind(d.reg);
		d.reg.mergeLocalEditFromBase = async (...a: any[]) => {
			const out = await (orig as any)(...a);
			d.disk.set(d.PATH, `${d.disk.get(d.PATH)}typed during merge\n`);
			d.reg.mergeLocalEditFromBase = orig;
			return out;
		};
	}
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
	// what adoptCreateAck does with it
	d.engine.recordCrdtBaseline(d.PATH, consumed, { markCreated: true });
	return { d, consumed };
}

async function ingest(d: ReturnType<typeof fmDevice>) {
	const reread = () => d.engine.app.vault.cachedRead(d.file);
	const consumed = await d.reg.applyLocalEdit(d.ID, d.disk.get(d.PATH)!, undefined, reread);
	if (consumed !== null) d.engine.recordCrdtBaseline(d.PATH, consumed);
	await tick();
}

for (const mode of ["fail", "moved"] as const) {
	test(`${mode}: state after create`, async () => {
		const { d, consumed } = await occupied(mode, `st-${mode}`);
		try {
			const doc = await d.reg.projectedText(d.ID);
			expect(consumed).toBe(d.disk.get(d.PATH)!.replace("typed during merge\n", ""));
			expect(doc).toContain(SERVER);
		} finally {
			await d.reg.destroyAll();
		}
	});

	test(`${mode}: user edits disk after, server edit kept and written`, async () => {
		const { d } = await occupied(mode, `ed-${mode}`);
		try {
			d.disk.set(d.PATH, d.disk.get(d.PATH)!.replace("third", "third, user later"));
			await ingest(d);
			const doc = await d.reg.projectedText(d.ID);
			expect(doc).toContain(SERVER);
			expect(doc).toContain("local edit");
			expect(doc).toContain("user later");
			if (mode === "moved") expect(doc).toContain("typed during merge");
			expect(d.disk.get(d.PATH)).toBe(doc);
			// a second edit must still keep it
			d.disk.set(d.PATH, `${d.disk.get(d.PATH)}more\n`);
			await ingest(d);
			expect(await d.reg.projectedText(d.ID)).toContain(SERVER);
			expect(d.disk.get(d.PATH)).toContain(SERVER);
		} finally {
			await d.reg.destroyAll();
		}
	});

	test(`${mode}: user REVERTS own local edit on disk, server edit kept`, async () => {
		const { d } = await occupied(mode, `rv-${mode}`);
		try {
			d.disk.set(d.PATH, d.disk.get(d.PATH)!.replace("local edit\n", ""));
			await ingest(d);
			const doc = await d.reg.projectedText(d.ID);
			expect(doc).toContain(SERVER);
			expect(doc).not.toContain("local edit");
			expect(d.disk.get(d.PATH)).toBe(doc);
		} finally {
			await d.reg.destroyAll();
		}
	});

	test(`${mode}: same-bytes rescan (no edit) heals disk or leaves doc intact`, async () => {
		const { d } = await occupied(mode, `rs-${mode}`);
		try {
			await ingest(d);
			const doc = await d.reg.projectedText(d.ID);
			expect(doc).toContain(SERVER);
		} finally {
			await d.reg.destroyAll();
		}
	});

	test(`${mode}: next remote flush puts the server edit on disk`, async () => {
		const { d } = await occupied(mode, `rf-${mode}`);
		try {
			if (mode === "moved") await ingest(d); // the typing's own modify
			await remoteEdit(d, "body", "body, second server edit");
			await tick(50);
			const doc = await d.reg.projectedText(d.ID);
			expect(doc).toContain(SERVER);
			expect(d.disk.get(d.PATH)).toBe(doc);
		} finally {
			await d.reg.destroyAll();
		}
	});
}

test("stored create: a failed merge write stamps what disk holds", async () => {
	const raw2 = "---\ntitle: x\n---\nbody\nsecond line\n";
	const d = fmDevice("stored-fail", `${raw2}edited during the create\n`);
	try {
		const realModify = d.engine.app.vault.modify;
		let n = 0;
		d.engine.app.vault.modify = async (...a: any[]) => {
			// let the apply's flush land, fail the merge write-back
			if (n++ === 1) throw new Error("EACCES");
			return realModify(...a);
		};
		const consumed = await d.engine.seedBodyAfterCreate({
			effectiveId: d.ID,
			normalized: d.PATH,
			file: d.file,
			seeded: true,
			sameId: true,
			genesisOutcome: "stored",
			genesisUpdate: d.reg.encodeGenesisUpdate(raw2),
			genesisContent: raw2,
		});
		expect(consumed).toBe(d.disk.get(d.PATH));
		expect(await d.reg.projectedText(d.ID)).toContain("edited during the create");
		d.engine.recordCrdtBaseline(d.PATH, consumed, { markCreated: true });
		d.disk.set(d.PATH, `${d.disk.get(d.PATH)}later\n`);
		await ingest(d);
		expect(await d.reg.projectedText(d.ID)).toContain("edited during the create");
		expect(d.disk.get(d.PATH)).toContain("edited during the create");
	} finally {
		await d.reg.destroyAll();
	}
});

test("own-base branch: disk holds our base, doc has server edit; later user edit keeps server edit", async () => {
	const d = fmDevice("ownbase", raw);
	try {
		await d.reg.applyRemoteUpdate(d.ID, d.reg.encodeGenesisUpdate(raw));
		await remoteEdit(d, "second line", SERVER);
		d.engine.ownGenesis.set(d.ID, raw);
		d.engine.readServerDocState = async () => null;
		d.disk.set(d.PATH, raw); // the flush of the server edit never landed
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
		d.engine.recordCrdtBaseline(d.PATH, consumed, { markCreated: true });
		d.disk.set(d.PATH, d.disk.get(d.PATH)!.replace("third", "third, user later"));
		await ingest(d);
		const doc = await d.reg.projectedText(d.ID);
		expect(doc).toContain(SERVER);
		expect(doc).toContain("user later");
	} finally {
		await d.reg.destroyAll();
	}
});

test("re-id'd adopt: a flush that did not write stamps what disk holds, not the server text", async () => {
	const d = fmDevice("adopt-nowrite", raw);
	try {
		// The server's lineage: our body plus a server edit.
		const peer = new Y.Doc();
		Y.applyUpdate(peer, d.reg.encodeGenesisUpdate(raw));
		const t = peer.getText(CONTENT_KEY);
		const at = t.toJSON().indexOf("second line");
		peer.transact(() => {
			t.delete(at, "second line".length);
			t.insert(at, SERVER);
		});
		const b64 = Buffer.from(Y.encodeStateAsUpdate(peer)).toString("base64");
		d.engine.readServerDocState = async () => ({ b64 });
		// The apply's flush does not reach disk (a bound note's nudge, a refusal).
		d.engine.flushFromCrdt = async () => undefined;
		const consumed = await d.engine.seedBodyAfterCreate({
			effectiveId: d.ID,
			normalized: d.PATH,
			file: d.file,
			seeded: true,
			sameId: false,
			genesisOutcome: "stored",
			genesisUpdate: undefined,
			genesisContent: undefined,
		});
		expect(await d.reg.projectedText(d.ID)).toContain(SERVER);
		expect(consumed).toBe(raw);
	} finally {
		await d.reg.destroyAll();
	}
});

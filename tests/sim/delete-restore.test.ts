// tests/sim/delete-restore.test.ts
//
// Server-side delete, then restore (backend safer delete, Engram#2233 e2e
// test_106), on the real SyncEngine against the model server.
//
// DIFFERENTIAL PROOF (source overlay): `git show origin/main:src/sync.ts` and
// `src/crdt/provider-registry.ts` over the fix turns BOTH tests red: B logs
// `Note was destroyed` and never re-materializes the note; the attachment
// delete leaves `img.png (conflict <stamp>).md`. Dropping only the post-revive
// handshake leaves the note on disk with an EMPTY doc, which assertConverged
// rejects.
import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { assertConverged } from "./oracle";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

test("#2233 server delete then restore: the note reappears once, same id", async () => {
	const t = await boot(2233, ["A", "B"]);
	try {
		const [a, b] = t.replicas;
		const notePath = "Restore/alpha.md";
		const content = "alpha body";
		await a.createNote(notePath, content);
		await t.scheduler.drain();
		const noteId = a.noteIdMap.get(notePath);
		if (!noteId) throw new Error("A never learned the note id");

		const onB = path.join(b.vaultDir, notePath);
		expect(fs.readFileSync(onB, "utf8")).toBe(content);

		t.server.serverDeleteNote(noteId);
		await t.scheduler.drain();
		expect(fs.existsSync(onB)).toBe(false);

		t.server.serverRestoreNote(noteId);
		await t.scheduler.drain();

		expect(fs.existsSync(onB) ? fs.readFileSync(onB, "utf8") : null).toBe(content);
		expect(b.noteIdMap.get(notePath)).toBe(noteId);
		// Exactly once: no conflict copy, no second file beside it.
		expect(fs.readdirSync(path.dirname(onB))).toEqual([path.basename(onB)]);
		// Disk, Y.Doc and id on both replicas equal the server (one lineage).
		await assertConverged(t.replicas, t.server, t.scheduler);
	} finally {
		cleanup(t);
	}
});

test("#2233 server delete of a just-synced attachment writes no .md copy", async () => {
	const t = await boot(2234, ["A"]);
	try {
		const [a] = t.replicas;
		const attachmentPath = "Restore/img.png";
		await a.createAttachment(
			attachmentPath,
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
		);
		await t.scheduler.drain();
		expect(t.server.hasAttachment(attachmentPath)).toBe(true);

		t.server.serverDeleteAttachment(attachmentPath);
		await t.scheduler.drain();

		const dir = path.join(a.vaultDir, "Restore");
		expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
	} finally {
		cleanup(t);
	}
});

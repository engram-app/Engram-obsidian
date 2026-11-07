/**
 * An occupied re-sent create under our own id, disk still at what we sent: the
 * baseline must be what disk holds (the flush kept disk's frontmatter bytes),
 * not the bare projection (PR 683 delta review; Engram#1928 class).
 */
import { expect, test } from "bun:test";
import { FM_SHAPES, fmDevice } from "./helpers/first-sync-fm";

for (const [name, fm] of Object.entries(FM_SHAPES)) {
	test(`occupied own-base create of "${name}": baseline is what disk holds`, async () => {
		const raw = `${fm}body of ${name}\n`;
		const { PATH, ID, disk, file, engine, reg } = fmDevice(name, raw);
		try {
			// This device already holds the lineage (an earlier create of it that
			// landed); the re-sent create answers occupied under the same id.
			await reg.applyRemoteUpdate(ID, reg.encodeGenesisUpdate(raw));
			expect(disk.get(PATH)).toBe(raw); // flush kept disk's bytes
			engine.ownGenesis.set(ID, raw);
			engine.readServerDocState = async () => null; // adopt unreachable
			const consumed = await engine.seedBodyAfterCreate({
				effectiveId: ID,
				normalized: PATH,
				file,
				seeded: false,
				sameId: true,
				genesisOutcome: "occupied",
				genesisUpdate: undefined,
				genesisContent: undefined,
			});
			await engine.adoptCreateAck(ID, PATH, consumed, { flushHeld: false });

			const now = disk.get(PATH) as string;
			expect(now).toBe(raw); // equal by meaning: the user's bytes are kept
			// Disk untouched since the apply must read as synced, or catch-up
			// drift-copies the note.
			expect(engine.isUnchangedSynced(PATH, now)).toBe(true);
			expect(engine.needsColdReconcile(PATH, now)).toBe(false);
		} finally {
			await reg.destroyAll();
		}
	});
}

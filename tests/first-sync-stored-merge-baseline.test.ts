/**
 * A stored create whose disk moved during the round trip, where the DOC side
 * also changed the frontmatter (a key the stored state added): merge3 keeps
 * disk's lines and adds the doc's, a hybrid no file holds. The baseline must
 * be the bytes the write actually left on disk, never `merged` (delta review
 * on PR 683, finding 3; adopted from the reviewer's probe).
 */
import { expect, test } from "bun:test";
import { FM_SHAPES, fmDevice } from "./helpers/first-sync-fm";

const EXTRA = ["status: done\n", "zzz: 1\n"];
for (const [name, fm] of Object.entries(FM_SHAPES)) {
	for (const extra of EXTRA) {
		test(`stored create of "${name}" + doc-side ${extra.trim()}: baseline is what disk holds`, async () => {
			const raw = `${fm}body of ${name}\nsecond line\n`;
			const docSide = `${fm.replace(/---\n$/, `${extra}---\n`)}body of ${name}\nsecond line\n`;
			const d = fmDevice(name, `${raw}edited during the create\n`);
			try {
				const consumed = await d.engine.seedBodyAfterCreate({
					effectiveId: d.ID,
					normalized: d.PATH,
					file: d.file,
					seeded: true,
					sameId: true,
					genesisOutcome: "stored",
					genesisUpdate: d.reg.encodeGenesisUpdate(docSide),
					genesisContent: raw,
				});
				expect(consumed).toBe(d.disk.get(d.PATH));
			} finally {
				await d.reg.destroyAll();
			}
		});
	}
}

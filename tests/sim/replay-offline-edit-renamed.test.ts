// Real-Obsidian probe 40249390517: A is offline, B renames a note, A edits it
// closed at the old path, A is killed and relaunched online. A's receiver-side
// rename reset the row to `{ hash: 0 }`, so the delivered edit came back to A
// as a divergence from "unknown" (here: conflict copies of the note).
import { afterAll, test } from "bun:test";
import { expectReplayClean, op } from "./replay";
import { Replica } from "./replica";

afterAll(() => Replica.restoreGlobals());

for (const [kill, seed] of [
	["crash", 1],
	["restart", 11],
] as const) {
	test(`seed ${seed}: an offline edit to a note renamed elsewhere survives a ${kill}`, async () => {
		await expectReplayClean(seed, [
			op("create", 1, 0, 0, 0, 30),
			op("offline", 0, 0, 0, 0, 2),
			op("rename", 1, 0, 0, 0, 30),
			op("edit", 0, 0, 0, 5, 2),
			op(kill, 0, 0, 0, 0, 0),
			op("online", 0, 0, 0, 0, 40),
		]);
	});
}

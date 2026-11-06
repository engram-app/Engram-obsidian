// The renaming device used to reset its own row to a presence-only
// `{ hash: 0 }`, so a catch-up after a dropped socket read its unedited notes
// as diverged and wrote conflict copies of them.
import { afterAll, test } from "bun:test";
import { expectReplayClean, op } from "./replay";
import { Replica } from "./replica";

afterAll(() => Replica.restoreGlobals());

test("seed 5: the renaming device keeps its baseline across a dropped socket", async () => {
	await expectReplayClean(5, [
		op("create", 1, 0, 0, 2, 0),
		op("create", 1, 0, 1, 2, 3),
		op("folderRename", 1, 0, 0, 909, 2),
		op("lostFrame", 1, 0, 0, 645, 5),
	]);
});

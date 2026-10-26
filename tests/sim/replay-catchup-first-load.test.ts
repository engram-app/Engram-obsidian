// Catch-up's drift-copy branch and the load interlock both resolved the same
// held edit: the load merged it and catch-up had already copied it (fuzz seed
// 11; real-Obsidian chaos soak 40247603066 shows copies of this shape).
import { afterAll, test } from "bun:test";
import { expectReplayClean, op } from "./replay";
import { Replica } from "./replica";

afterAll(() => Replica.restoreGlobals());

test("seed 11: an edit the load gate holds is resolved once, by the load, not copied by catch-up", async () => {
	await expectReplayClean(11, [
		op("create", 1, 0, 0, 0, 2),
		op("create", 1, 0, 1, 2, 0),
		op("restore", 0, 1, 0, 340, 5),
		op("edit", 1, 0, 0, 348, 2),
		op("open", 1, 0, 2, 408, 4),
		op("create", 1, 0, 7, 944, 5),
		op("online", 0, 1, 4, 281, 5),
		op("close", 1, 0, 1, 17, 5),
		op("edit", 0, 1, 0, 580, 2),
		op("snapshot", 1, 0, 7, 895, 5),
		op("conflict", 0, 1, 1, 11, 3),
	]);
});

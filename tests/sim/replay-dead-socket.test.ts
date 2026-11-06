import { afterAll, test } from "bun:test";
import { expectReplayClean, op } from "./replay";
import { Replica } from "./replica";

afterAll(() => Replica.restoreGlobals());

test("seed 21: an idle edit pushed on a dead socket reaches the server after the rejoin", async () => {
	await expectReplayClean(21, [
		op("create", 1, 0, 1, 2, 0),
		op("editOpen", 1, 0, 1, 616, 2),
		op("restart", 1, 0, 1, 672, 6),
		op("edit", 0, 1, 1, 456, 2),
		op("suspend", 0, 1, 1, 557, 1),
	]);
});

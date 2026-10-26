// The first server load of a note whose create-ack is still in flight read
// the creator's own pre-create bytes as a held local edit, and the load
// interlock wrote a conflict copy of them (fuzz seed 6; real-Obsidian chaos
// soak 40247603066 shows copies of this shape).
import { afterAll, test } from "bun:test";
import { expectReplayClean, op } from "./replay";
import { Replica } from "./replica";

afterAll(() => Replica.restoreGlobals());

test("seed 6: a remote edit loaded before the create-ack writes no copy of the creator's own body", async () => {
	await expectReplayClean(6, [
		op("create", 0, 0, 0, 0, 0),
		op("snapshot", 2, 1, 0, 526, 3),
		op("dupFrame", 1, 0, 0, 216, 6),
		op("remoteEdit", 0, 2, 0, 770, 0),
	]);
});

// A second crdt_create for a note whose first create already landed gets
// "occupied". It used to adopt the server and then diff stale disk onto it
// two-way, deleting a remote edit made in between (no conflict copy).
import { afterAll, test } from "bun:test";
import { expectReplayClean, op } from "./replay";
import { Replica } from "./replica";

afterAll(() => Replica.restoreGlobals());

test("seed 3: the orphan repair's duplicate create does not revert a remote edit", async () => {
	await expectReplayClean(3, [
		op("create", 0, 0, 0, 0, 2),
		op("edit", 2, 1, 0, 10, 4),
		op("editOpen", 0, 1, 0, 254, 4),
		op("remoteEdit", 2, 1, 0, 38, 5),
	]);
});

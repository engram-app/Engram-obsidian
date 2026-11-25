/**
 * The crdt: rejoin runs folder ops before the note-op queue, then catch-up
 * (src/main.ts onCrdtJoined). The sim harness keeps its OWN copy of that order
 * (tests/sim/replica.ts), so a sim test cannot notice main.ts drifting. This
 * pins main.ts itself: a queued create must be re-keyed by a folder op before
 * it is sent, or it lands at the old path.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("main.ts rejoin steps run folder ops, then note ops, then catch-up", () => {
	const src = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
	const at = (needle: string) => src.indexOf(needle);
	const folder = at('step("folder ops"');
	const notes = at('step("note ops"');
	const catchUp = at('step("catch-up"');
	expect(folder).toBeGreaterThan(-1);
	expect(notes).toBeGreaterThan(folder);
	expect(catchUp).toBeGreaterThan(notes);
});

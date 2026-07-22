// tests/sim/globals-restore.test.ts
//
// Proves the suite-order leak is CLOSED: Replica.boot() installs process-global
// monkey-patches (SimClock over Date.now + timers, setInterval -> () => 0,
// SimWebSocket, a fresh indexedDB) and Replica.restoreGlobals() must undo them.
// Within `bun test tests/sim/` the patches are harmless; in a full `bun test`
// run they would leak to any file sorted AFTER tests/sim/. This test boots a
// replica (patches ACTIVE), restores, and asserts the reals are back.
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SimClock } from "./clock";
import { ModelServer } from "./model-server";
import { Replica } from "./replica";
import { Scheduler } from "./scheduler";

// A real epoch is ~1.7e12; the virtual clock starts at 0. That gap is the
// discriminator between a frozen SimClock Date.now and the real one.
const REAL_EPOCH_FLOOR = 1_700_000_000_000;

test("Replica.restoreGlobals() undoes boot()'s global patches", async () => {
	const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "globals-restore-"));
	try {
		const clock = new SimClock();
		const scheduler = new Scheduler(1, clock);
		const server = new ModelServer({ scheduler });
		await Replica.boot({ id: "A", server, scheduler, clock, rootDir });

		// Patches ACTIVE: Date.now is frozen at virtual 0, setInterval is the stub.
		expect(Date.now()).toBeLessThan(REAL_EPOCH_FLOOR);
		expect(setInterval(() => {}, 1)).toBe(0);

		Replica.restoreGlobals();

		// Reals are back: Date.now reports a real epoch and setInterval returns a
		// real (truthy, non-zero-stub) handle. Clear it immediately so no interval
		// survives the test.
		expect(Date.now()).toBeGreaterThan(REAL_EPOCH_FLOOR);
		const id = setInterval(() => {}, 1_000_000);
		expect(id).toBeTruthy();
		clearInterval(id);

		// Idempotent: a second restore is a no-op, not a throw.
		expect(() => Replica.restoreGlobals()).not.toThrow();
	} finally {
		Replica.restoreGlobals();
		fs.rmSync(rootDir, { recursive: true, force: true });
	}
});

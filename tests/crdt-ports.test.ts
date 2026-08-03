/**
 * Tests for the CrdtPorts wiring seam (#376 prerequisite 2).
 *
 * The 15 CRDT late-injection setters collapse into one `setCrdtPorts(patch)`
 * primitive: a patch assigns ONLY the keys it names (wiring happens at
 * several lifecycle stages — boot, channel-join, teardown — each passing its
 * subset), an explicitly-null key clears its port, and the legacy setters
 * remain as thin shims because the backend e2e harness
 * (engram/e2e/headless/run.ts) and tests/sim/replica.ts call them.
 */
import { describe, expect, mock, test } from "bun:test";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

type AnyEngine = Record<string, any>;

function makeEngine(): AnyEngine {
	return new SyncEngine(
		{} as any,
		{} as any,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	) as unknown as AnyEngine;
}

describe("setCrdtPorts", () => {
	test("a patch assigns only the keys it names", () => {
		const e = makeEngine();
		const manager = { tag: "mgr" };
		const create = async () => "id";
		e.setCrdtPorts({ manager, create });
		expect(e.crdt).toBe(manager);
		expect(e.crdtCreate).toBe(create);
		// Unnamed ports untouched (boot defaults).
		expect(e.noteIdMap).toBeNull();
		expect(e.crdtEnqueue).toBeNull();
	});

	test("a later stage's patch does not clobber an earlier stage's ports", () => {
		const e = makeEngine();
		const noteIdMap = { tag: "map" };
		e.setCrdtPorts({ noteIdMap });
		e.setCrdtPorts({ manager: { tag: "mgr" } });
		expect(e.noteIdMap).toBe(noteIdMap);
	});

	test("an explicit null clears the port (teardown stage)", () => {
		const e = makeEngine();
		e.setCrdtPorts({ manager: { tag: "mgr" }, enrollment: { enroll() {}, reset() {} } });
		e.setCrdtPorts({ manager: null, enrollment: null });
		expect(e.crdt).toBeNull();
		expect(e.crdtEnrollment).toBeNull();
	});

	test("liveBound patch replaces the default never-bound check", () => {
		const e = makeEngine();
		expect(e.isLiveBound("a.md")).toBe(false);
		e.setCrdtPorts({ liveBound: (p: string) => p === "a.md" });
		expect(e.isLiveBound("a.md")).toBe(true);
		expect(e.isLiveBound("b.md")).toBe(false);
	});

	test("nulling liveBound restores the default instead of clearing it", () => {
		const e = makeEngine();
		e.setCrdtPorts({ liveBound: () => true });
		// isLiveBound is called unconditionally on the push path, so this port
		// must never be left empty — clearing it means "nothing is bound".
		e.setCrdtPorts({ liveBound: null });
		expect(e.isLiveBound("a.md")).toBe(false);
	});
});

describe("legacy setters are shims over setCrdtPorts", () => {
	test("each harness-facing setter still lands in the same port", () => {
		const e = makeEngine();
		const manager = { tag: "mgr" };
		const map = { tag: "map" };
		e.setCrdtManager(manager);
		e.setNoteIdMap(map);
		e.setDeviceId("dev-1");
		e.setCrdtLiveCheck(() => true);
		e.setLiveBoundCheck(() => true);
		expect(e.crdt).toBe(manager);
		expect(e.noteIdMap).toBe(map);
		expect(e.deviceId).toBe("dev-1");
		expect(e.crdtLive()).toBe(true);
		expect(e.isLiveBound("x")).toBe(true);
	});
});

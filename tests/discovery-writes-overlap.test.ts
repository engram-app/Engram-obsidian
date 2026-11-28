/**
 * Two discovery writes for one path can overlap (several entry points reach
 * applyChange). The in-flight mark must hold until the LAST one ends, or the
 * first to finish reopens the create-race window of e2e test_84 for the other.
 */
import { expect, mock, test } from "bun:test";
import type { EngramApi } from "../src/api";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

type Marks = {
	beginDiscoveryWrite(path: string): void;
	endDiscoveryWrite(path: string): void;
	discoveryWriteInFlight(path: string): boolean;
};

function engine(): Marks {
	const app = {
		vault: { configDir: ".obsidian", getFiles: mock().mockReturnValue([]) },
		workspace: { getLeavesOfType: mock().mockReturnValue([]) },
	} as never;
	return new SyncEngine(
		app,
		{} as EngramApi,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	) as unknown as Marks;
}

test("overlapping discovery writes keep the path in flight until the last ends", () => {
	const e = engine();
	e.beginDiscoveryWrite("notes/a.md");
	e.beginDiscoveryWrite("notes/a.md");
	e.endDiscoveryWrite("notes/a.md");
	expect(e.discoveryWriteInFlight("notes/a.md")).toBe(true);
	e.endDiscoveryWrite("notes/a.md");
	expect(e.discoveryWriteInFlight("notes/a.md")).toBe(false);
});

test("an unmatched end never goes negative", () => {
	const e = engine();
	e.endDiscoveryWrite("notes/a.md");
	e.beginDiscoveryWrite("notes/a.md");
	expect(e.discoveryWriteInFlight("notes/a.md")).toBe(true);
});

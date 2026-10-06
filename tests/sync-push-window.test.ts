/**
 * pushPartitioned runs a sliding window, not fixed slices with a barrier.
 *
 * Under slices, one slow file (a big attachment upload, a crdt_create stuck
 * behind the server's serial channel queue) held back the next slice's files
 * until it finished, and every slice boundary drained the pipeline for a full
 * round trip. The window starts the next file as soon as ANY file finishes.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import { TFile } from "obsidian";
import type { EngramApi } from "../src/api";
import { rlog } from "../src/remote-log";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";
import { recordCoreUse, takeCoreUsage } from "../src/wasm-core";

function makeEngine(): SyncEngine {
	const app = {
		vault: { configDir: ".obsidian", getName: () => "T", getFiles: () => [] },
		workspace: { getActiveViewOfType: () => null },
	};
	return new SyncEngine(
		app as any,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
}

const files = (n: number) => Array.from({ length: n }, (_, i) => new TFile(`n${i}.md`, 0));
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("pushPartitioned sliding window", () => {
	test("a slow file does not hold back files past the first 10", async () => {
		const engine = makeEngine();
		let releaseSlow!: (v: boolean) => void;
		const started: string[] = [];
		spyOn(engine as any, "pushFile").mockImplementation(((f: TFile) => {
			started.push(f.path);
			if (f.path === "n0.md") return new Promise<boolean>((r) => (releaseSlow = r));
			return Promise.resolve(true);
		}) as any);

		const run = (engine as any).pushPartitioned(files(25), "incremental");
		for (let i = 0; i < 20; i++) await tick();
		// Everything but the slow file has been started and finished already.
		expect(started.length).toBe(25);
		releaseSlow(true);
		expect(await run).toEqual({ pushed: 25, failed: 0 });
	});

	test("never more than 10 files in flight, starts in input order", async () => {
		const engine = makeEngine();
		let inFlight = 0;
		let peak = 0;
		const started: string[] = [];
		spyOn(engine as any, "pushFile").mockImplementation((async (f: TFile) => {
			started.push(f.path);
			inFlight++;
			peak = Math.max(peak, inFlight);
			await tick();
			inFlight--;
			return true;
		}) as any);

		expect(await (engine as any).pushPartitioned(files(37), "incremental")).toEqual({
			pushed: 37,
			failed: 0,
		});
		expect(peak).toBe(10);
		expect(started).toEqual(files(37).map((f) => f.path));
	});

	// A throwing UI/heal callback aborts the sweep (as the slice code did), but
	// the window must stop taking files and settle in-flight ones before it
	// rejects, not leave workers draining the list unawaited.
	test("a throwing callback stops the window and rejects after in-flight settle", async () => {
		const engine = makeEngine();
		const boom = new Error("callback boom");
		engine.onVaultScopedError = () => {
			throw boom;
		};
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const started: string[] = [];
		spyOn(engine as any, "pushFile").mockImplementation((async (f: TFile) => {
			started.push(f.path);
			if (f.path === "n0.md") throw new Error("push failed");
			await gate;
			return true;
		}) as any);

		let settled = false;
		const run = (engine as any).pushPartitioned(files(25), "incremental").finally(() => {
			settled = true;
		});
		run.catch(() => {});
		for (let i = 0; i < 10; i++) await tick();
		expect(settled).toBe(false);
		release();
		await expect(run).rejects.toBe(boom);
		expect(started.length).toBe(10);
	});

	test("a throwing file is counted, the rest still run; empty input is a no-op", async () => {
		const engine = makeEngine();
		spyOn(engine as any, "pushFile").mockImplementation((async (f: TFile) => {
			if (f.path === "n3.md") throw new Error("boom");
			return true;
		}) as any);
		expect(await (engine as any).pushPartitioned(files(12), "incremental")).toEqual({
			pushed: 11,
			failed: 1,
		});
		expect(await (engine as any).pushPartitioned([], "incremental")).toEqual({
			pushed: 0,
			failed: 0,
		});
	});

	// Client info never reaches Loki, so the per-sweep engine usage rides the
	// warn-level sweep line, after its existing text.
	test("the sweep line carries the core usage and drains it", async () => {
		const engine = makeEngine();
		spyOn(engine as any, "pushFile").mockImplementation((async () => {
			recordCoreUse("fnv1a", "wasm", 1048576);
			return true;
		}) as any);
		const warn = spyOn(rlog(), "warn");
		takeCoreUsage();
		await (engine as any).pushPartitioned(files(2), "incremental");
		const line = warn.mock.calls.map((c) => c[1]).find((m) => m.startsWith("Sweep done"));
		expect(line).toBe(
			"Sweep done (incremental) — pushed=2 skipped=0 failed=0 of 2 | core: fnv1a:wasm 2 calls/2.0 MB",
		);
		expect(takeCoreUsage()).toBe("none");
		warn.mockRestore();
	});

	test("an aborted sweep still drains its core usage", async () => {
		const engine = makeEngine();
		engine.onVaultScopedError = () => {
			throw new Error("abort");
		};
		spyOn(engine as any, "pushFile").mockImplementation((async () => {
			recordCoreUse("base64", "js", 10);
			throw new Error("push failed");
		}) as any);
		takeCoreUsage();
		await expect((engine as any).pushPartitioned(files(1), "incremental")).rejects.toThrow(
			"abort",
		);
		expect(takeCoreUsage()).toBe("none");
	});
});

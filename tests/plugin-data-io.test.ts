/**
 * Unit tests for resilient plugin-data IO (data.json hardening, Phase C0).
 *
 * Background: Obsidian's saveData() → adapter.write() is NOT atomic. A quit or
 * crash mid-write can truncate data.json to 0 bytes; the next loadData() then
 * throws "Unexpected end of JSON input" and the whole plugin fails to load,
 * taking sync down globally. data.json holds non-resyncable creds (apiKey,
 * vaultId, deviceId), so we must recover from a backup before falling back to
 * defaults — unlike derived stores which can just "start fresh".
 *
 * atomicWriteJson: write a .tmp, demote the current file to .bak, then rename
 * .tmp over the primary. Every crash window leaves a parseable primary OR .bak.
 * resilientReadJson: read primary → .bak → .tmp, returning the first that
 * parses, and reporting where the data came from so the caller can warn on
 * recovery or data loss.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { atomicWriteJson, resilientReadJson } from "../src/plugin-data-io";

/** Fake DataAdapter that records reads/writes in memory and models Obsidian's
 *  semantics: read() throws on a missing file; rename() throws if the target
 *  already exists. */
function makeFakeAdapter() {
	const files: Record<string, string> = {};
	return {
		files,
		read: mock(async (path: string) => {
			if (!(path in files)) throw new Error(`File not found: ${path}`);
			return files[path];
		}),
		write: mock(async (path: string, data: string) => {
			files[path] = data;
		}),
		exists: mock(async (path: string) => path in files),
		remove: mock(async (path: string) => {
			delete files[path];
		}),
		rename: mock(async (from: string, to: string) => {
			if (to in files) throw new Error(`Rename target exists: ${to}`);
			if (!(from in files)) throw new Error(`Rename source missing: ${from}`);
			files[to] = files[from];
			delete files[from];
		}),
	};
}

const PATH = ".obsidian/plugins/engram-vault-sync/data.json";

describe("atomicWriteJson + resilientReadJson", () => {
	let adapter: ReturnType<typeof makeFakeAdapter>;

	beforeEach(() => {
		adapter = makeFakeAdapter();
	});

	it("round-trips: write then read returns the data from the primary file", async () => {
		await atomicWriteJson(adapter, PATH, { apiKey: "secret", n: 1 });
		const result = await resilientReadJson<{ apiKey: string; n: number }>(adapter, PATH);
		expect(result.data).toEqual({ apiKey: "secret", n: 1 });
		expect(result.source).toBe("primary");
	});

	it("leaves no .tmp file behind after a successful write", async () => {
		await atomicWriteJson(adapter, PATH, { a: 1 });
		expect(`${PATH}.tmp` in adapter.files).toBe(false);
	});

	it("retains the previous content in .bak after a second write", async () => {
		await atomicWriteJson(adapter, PATH, { v: "old" });
		await atomicWriteJson(adapter, PATH, { v: "new" });
		expect(JSON.parse(adapter.files[`${PATH}.bak`])).toEqual({ v: "old" });
		expect(JSON.parse(adapter.files[PATH])).toEqual({ v: "new" });
	});

	it("recovers the prior committed write from .bak when the primary is truncated to empty (the real bug)", async () => {
		await atomicWriteJson(adapter, PATH, { v: "committed" });
		await atomicWriteJson(adapter, PATH, { v: "latest" });
		// External truncation of the live file to 0 bytes (the outage scenario).
		// .bak holds the prior committed write; the latest is lost, which is the
		// accepted contract — we recover the last good state rather than crash.
		adapter.files[PATH] = "";
		const result = await resilientReadJson<{ v: string }>(adapter, PATH);
		expect(result.data).toEqual({ v: "committed" });
		expect(result.source).toBe("backup");
	});

	it("recovers the prior committed write from .bak when the primary is corrupt (partial JSON)", async () => {
		await atomicWriteJson(adapter, PATH, { v: "committed" });
		await atomicWriteJson(adapter, PATH, { v: "latest" });
		adapter.files[PATH] = '{"v":"lat';
		const result = await resilientReadJson<{ v: string }>(adapter, PATH);
		expect(result.data).toEqual({ v: "committed" });
		expect(result.source).toBe("backup");
	});

	it("recovers from .tmp when primary missing and no .bak (crash between demote and promote)", async () => {
		// Model the crash window: primary renamed to .bak then process died, but
		// here we go further — only a valid .tmp survives.
		adapter.files[`${PATH}.tmp`] = JSON.stringify({ v: "staged" });
		const result = await resilientReadJson<{ v: string }>(adapter, PATH);
		expect(result.data).toEqual({ v: "staged" });
		expect(result.source).toBe("tmp");
	});

	it("returns absent (data null) when no files exist at all (fresh install)", async () => {
		const result = await resilientReadJson(adapter, PATH);
		expect(result.data).toBeNull();
		expect(result.source).toBe("absent");
	});

	it("returns corrupt (data null) when files exist but none parse (true data loss)", async () => {
		adapter.files[PATH] = "";
		adapter.files[`${PATH}.bak`] = "{bad";
		const result = await resilientReadJson(adapter, PATH);
		expect(result.data).toBeNull();
		expect(result.source).toBe("corrupt");
	});

	it("never leaves the primary empty/corrupt even if the final promote fails mid-write", async () => {
		await atomicWriteJson(adapter, PATH, { v: "good" });
		// Make the final tmp→primary rename throw to simulate a crash at the
		// last step. The primary must still be readable (old good content).
		adapter.rename.mockImplementationOnce(async () => {
			throw new Error("simulated crash on promote");
		});
		await expect(atomicWriteJson(adapter, PATH, { v: "doomed" })).rejects.toThrow();
		const result = await resilientReadJson<{ v: string }>(adapter, PATH);
		expect(result.data).toEqual({ v: "good" });
	});
});

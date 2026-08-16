/**
 * `anomaly()` is the ONE rlog path that ships with diagnostics OFF, so its
 * "counts and reasons only" contract is the difference between consented
 * telemetry and a note path leaving the device unasked.
 *
 * Two earlier attempts at enforcing it failed, and the reason both failed is
 * the same: they filtered free text.
 *
 *   1. A source-compliance regex over `${...}` interpolations. Blind to
 *      `${p}`, `${String(err)}` and helper calls.
 *   2. A runtime redactor that split on whitespace and blanked tokens holding
 *      a separator or an extension. It let `Divorce settlement draft.md`
 *      through as "Divorce settlement [redacted]", and `TFile.basename` —
 *      which Obsidian returns WITHOUT the extension — through untouched.
 *
 * A note title IS prose. No text filter separates it from a reason string,
 * because there is no difference to find. So the free text is gone: `code` is
 * a developer-written slug and `counts` holds numbers and booleans. A path
 * cannot be expressed in the type.
 */
import { describe, expect, test } from "bun:test";
import { formatAnomaly } from "../src/remote-log";

describe("formatAnomaly — a path cannot be expressed", () => {
	// Every one of these defeated the previous redactor. None of them is
	// representable now: the values are not numbers or booleans, so they are
	// dropped rather than rendered.
	test.each([
		["Divorce settlement draft.md", "a filename with spaces"],
		["Divorce", "TFile.basename — no extension"],
		["Medical/labs.md", "a full path"],
		["ENOENT: no such file or directory, open 'Medical/labs.md'", "an Obsidian error"],
		["Notes.textbundle", "an extension longer than 6 chars"],
	])("drops %s (%s)", (leak) => {
		const line = formatAnomaly("replay_produced_no_files", {
			applied: 3,
			// @ts-expect-error — the type forbids this; the runtime drops it too.
			path: leak,
		});

		expect(line).not.toContain(leak);
		expect(line).not.toContain("Divorce");
		expect(line).not.toContain("Medical");
	});

	// `category` is the OTHER string parameter, and it was left free while
	// `code` was locked down. It reads like a label slot, so
	// `anomaly(file.path, "note_skipped", { seq })` is a natural thing to
	// write — and it rides the same force:true path into
	// `client_logs.category`, which the backend interpolates into a Logger
	// MESSAGE BODY ("[client:#{category}]") that RedactFilter refuses to touch
	// and that ships to Loki at warn.
	test("a category that is not a slug is replaced", async () => {
		const { initRemoteLog } = await import("../src/remote-log");
		const sent: { category: string }[] = [];

		const logger = initRemoteLog();
		logger.configure(
			async (entries) => {
				sent.push(...entries);
			},
			"1.0.0",
			"test",
		);
		logger.setEnabled(false); // diagnostics OFF — anomaly() bypasses this

		logger.anomaly("Medical/Divorce settlement draft.md", "note_skipped", { seq: 1 });
		await logger.flush();

		expect(sent.length).toBe(1);
		expect(sent[0].category).toBe("invalid_category");
		expect(JSON.stringify(sent[0])).not.toContain("Divorce");
		expect(JSON.stringify(sent[0])).not.toContain("Medical");
	});

	test("a real category still passes through", async () => {
		const { initRemoteLog } = await import("../src/remote-log");
		const sent: { category: string }[] = [];

		const logger = initRemoteLog();
		logger.configure(
			async (entries) => {
				sent.push(...entries);
			},
			"1.0.0",
			"test",
		);
		logger.setEnabled(false);

		logger.anomaly("sync", "note_skipped", { seq: 1 });
		await logger.flush();

		expect(sent[0].category).toBe("sync");
	});

	// A log helper must not be the thing that breaks the path it guards. The
	// backend's safe_reason/1 got a catch-all in this same series for exactly
	// this; `= {}` only covers undefined, so an explicit null threw.
	test("a null counts object does not throw", () => {
		expect(() => formatAnomaly("sync_stalled", null)).not.toThrow();
		expect(formatAnomaly("sync_stalled", null)).toBe("sync_stalled");
	});

	// `RegExp.test` stringifies, so a bare ternary handed a non-string back
	// unchanged and made the `: string` return type a lie.
	test("a non-string code returns the fallback string, not the input", () => {
		// @ts-expect-error — untyped callers are the only way in.
		expect(formatAnomaly(12345)).toBe("invalid_code");
		// @ts-expect-error
		expect(formatAnomaly(null)).toBe("invalid_code");
	});

	// The code itself is the other caller-controlled string.
	test("a code that is not a slug becomes invalid_code", () => {
		expect(formatAnomaly("skipped Medical/labs.md")).toBe("invalid_code");
	});

	test("a key that is not a slug is dropped", () => {
		expect(formatAnomaly("sync_stalled", { "Medical/labs.md": 1, applied: 2 })).toBe(
			"sync_stalled applied=2",
		);
	});
});

describe("formatAnomaly — counts survive intact", () => {
	// The other half matters as much: a mechanism that mangles `applied=12`
	// gets routed around. The previous redactor destroyed every decimal —
	// `v1.2.3`, `12.5s` and `0.95` all became [redacted].
	test("renders the real call site's counts", () => {
		expect(
			formatAnomaly("replay_produced_no_files", {
				applied: 12,
				files: 0,
				deletes: 0,
				failed: 1,
				complete: true,
				blocked: false,
			}),
		).toBe(
			"replay_produced_no_files applied=12 files=0 deletes=0 failed=1 complete=true blocked=false",
		);
	});

	test("decimals and negatives survive", () => {
		expect(formatAnomaly("pacer", { ratio: 0.95, drift: -1.5 })).toBe(
			"pacer ratio=0.95 drift=-1.5",
		);
	});

	test("a bare code with no counts", () => {
		expect(formatAnomaly("catch_up_skipped_sync_gate_closed")).toBe(
			"catch_up_skipped_sync_gate_closed",
		);
	});

	test("NaN and Infinity are dropped rather than rendered", () => {
		expect(formatAnomaly("pacer", { a: Number.NaN, b: Number.POSITIVE_INFINITY, c: 1 })).toBe(
			"pacer c=1",
		);
	});
});

describe("anomaly() is actually wired to formatAnomaly", () => {
	test("a value that is not a count never reaches the entry", async () => {
		const { initRemoteLog } = await import("../src/remote-log");
		const sent: { message: string }[] = [];

		const logger = initRemoteLog();
		logger.configure(
			async (entries) => {
				sent.push(...entries);
			},
			"1.0.0",
			"test",
		);
		logger.setEnabled(false); // diagnostics OFF — anomaly() bypasses this

		// @ts-expect-error — the type forbids a string value.
		logger.anomaly("sync", "replay_skipped", { path: "Medical/labs.md", applied: 2 });
		await logger.flush();

		expect(sent.length).toBeGreaterThan(0);
		expect(sent[0].message).not.toContain("Medical");
		expect(sent[0].message).not.toContain("labs");
		expect(sent[0].message).toBe("replay_skipped applied=2");
	});
});

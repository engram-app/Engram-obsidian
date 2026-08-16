/**
 * `anomaly()` is the ONE rlog path that ships with diagnostics OFF, so its
 * "counts and reasons only" contract is the difference between consented
 * telemetry and a note path leaving the device unasked.
 *
 * A source-compliance regex cannot enforce it. That guard reads `${...}`
 * interpolations, so it is blind to `${p}`, `${dest}`, `${String(err)}`, and to
 * a helper call with no interpolation at all — and `${String(err)}` is already
 * the house idiom, appearing 7x in src/. Obsidian's adapter throws
 * `ENOENT: no such file or directory, open 'Medical/labs.md'`.
 *
 * So the enforcement is at the choke point, and these are the shapes it has to
 * survive in both directions: paths blanked, counts untouched.
 */
import { describe, expect, test } from "bun:test";
import { redactPathLike } from "../src/remote-log";

describe("redactPathLike — paths never survive", () => {
	test.each([
		["ENOENT: no such file or directory, open 'Medical/labs.md'", ["Medical", "labs.md"]],
		["replay skipped Journal/2026-08-14 therapy.md", ["Journal", "therapy.md"]],
		["write failed for board.canvas", ["board.canvas"]],
		["rename Old/Path.md -> New/Path.md", ["Old", "New"]],
		["failed: C:\\Vault\\Private.md", ["Private.md"]],
	])("blanks the path in %s", (message, forbidden) => {
		const out = redactPathLike(message);
		for (const fragment of forbidden) {
			expect(out).not.toContain(fragment);
		}
		expect(out).toContain("[redacted]");
	});
});

describe("redactPathLike — counts and reasons survive", () => {
	// If this half fails the guard gets deleted, so it matters as much as the
	// half above. These are the two real anomaly() call sites, verbatim.
	test.each([
		"catch-up skipped — sync gate closed (blocked=true)",
		"replay produced no files: applied=12 files=0 deletes=0 failed=1 complete=true blocked=false",
		"handshake timed out after 30s",
		"queue drained: 40 ok, 2 retried",
	])("leaves %s untouched", (message) => {
		expect(redactPathLike(message)).toBe(message);
	});
});

// The sanitizer is worthless if anomaly() stops calling it. Reverting the call
// in remote-log.ts must fail here, not only in a source-text guard.
describe("anomaly() is actually wired to the sanitizer", () => {
	test("a path passed to anomaly() never reaches the entry", async () => {
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

		logger.anomaly("sync", "replay skipped Medical/labs.md");
		await logger.flush();

		expect(sent.length).toBeGreaterThan(0);
		expect(sent[0].message).not.toContain("Medical");
		expect(sent[0].message).not.toContain("labs.md");
	});
});

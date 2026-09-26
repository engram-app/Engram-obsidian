/**
 * Privacy guard for the remote-log egress point.
 *
 * `client_logs` stores `message` and `stack` in plaintext for 30 days and the
 * backend re-emits warn+ lines to Loki. Call sites are supposed to route paths
 * through `noteRef()` / `errMsg(e, path)`, but one forgotten `e.stack` ships the
 * raw error message (path + OS username) — so the logger itself must scrub.
 */
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { OAuthAuth } from "../src/auth";
import { InvariantChecker } from "../src/crdt/invariants";
import { scrubLogText, scrubStack } from "../src/error-util";
import { type RemoteLogEntry, RemoteLogger, rlog } from "../src/remote-log";

const ABS_CANARY = "/Users/alice/Vault/Medical/canary-7d1.md";
const REL_CANARY = "Medical/canary-7d1.md";
const WIN_CANARY = "C:\\Users\\alice\\Vault\\Medical\\canary-7d1.md";

function capture(): { logger: RemoteLogger; entries: () => RemoteLogEntry[] } {
	const logger = new RemoteLogger();
	const pushFn = mock().mockResolvedValue(undefined);
	logger.configure(pushFn, "1.0.0", "desktop");
	logger.setLevelThreshold("debug");
	logger.setEnabled(true);
	return {
		logger,
		entries: () => {
			void logger.flush();
			return pushFn.mock.calls.flatMap((c) => c[0] as RemoteLogEntry[]);
		},
	};
}

function assertClean(serialized: string): void {
	expect(serialized).not.toContain("canary-7d1");
	expect(serialized).not.toContain("alice");
	expect(serialized).not.toContain("Medical");
}

describe("remote-log egress scrub (chokepoint)", () => {
	test("canary path in message AND stack never reaches the queued entry", () => {
		const { logger, entries } = capture();
		const err = new Error(`ENOENT: no such file or directory, open ${ABS_CANARY}`);
		logger.error("push", `Push failed: n1 — ${err.message} | category=network`, err.stack);
		logger.error("push", `quoted '${ABS_CANARY}' and relative ${REL_CANARY}`, err.stack);
		logger.warn("push", `3 files failed to sync (${REL_CANARY})`);
		logger.info("pull", `windows ${WIN_CANARY} | n=2`);
		logger.diag("vault", `modify path=${REL_CANARY} bytes=10`);
		logger.anomaly("sync", "note_skipped", { seq: 4 });

		const out = entries();
		expect(out).toHaveLength(6);
		assertClean(JSON.stringify(out));
	});

	test("a stack keeps its frames and error name but drops the message line", () => {
		const { logger, entries } = capture();
		const stack = [
			`Error: ENOENT: no such file or directory, open ${ABS_CANARY}`,
			"    at pushFile (plugin:engram-vault-sync:123:45)",
			"    at async SyncEngine.flush (plugin:engram-vault-sync:200:1)",
		].join("\n");
		logger.error("push", "boom", stack);
		const [entry] = entries();
		expect(entry.stack).toContain("at pushFile (plugin:engram-vault-sync:123:45)");
		expect(entry.stack).toContain("at async SyncEngine.flush");
		expect(entry.stack?.startsWith("Error")).toBe(true);
		assertClean(entry.stack ?? "");
	});

	test("scrubbing preserves the diagnostic signal", () => {
		const line =
			"Push failed: n12 — ENOENT: no such file or directory | category=server status=502 count=3 POST /api/notes returned 500 at plugin:engram-vault-sync:12:3";
		expect(scrubLogText(line)).toBe(line);
	});
});

describe("scrubLogText", () => {
	test.each([
		[`open ${ABS_CANARY}`],
		[`open '${ABS_CANARY}'`],
		[`open "Medical/Tom's canary-7d1.md"`],
		[`for ${REL_CANARY} now`],
		[`at ${WIN_CANARY}`],
		["see ~/Vault/Medical/canary-7d1.md"],
		["/home/alice/Vault/Medical/canary-7d1.md"],
		["(Medical/canary-7d1.md)"],
		["photo Medical/canary-7d1.png failed"],
	])("scrubs %s", (input) => {
		assertClean(scrubLogText(input));
		expect(scrubLogText(input)).toContain("<path>");
	});

	test("home-dir anchor stops at the field separator", () => {
		expect(scrubLogText(`open /Users/alice/My Vault/x.md | category=network`)).toBe(
			"open <path> | category=network",
		);
	});

	test("does not treat URLs as Windows drive paths", () => {
		const url = "fetch https://api.engram.page/api/notes failed";
		expect(scrubLogText(url)).toBe(url);
	});

	test("is linear on large adversarial input", () => {
		const big = `${"a/".repeat(20_000)} ${"x.".repeat(20_000)}`;
		const t0 = performance.now();
		scrubLogText(big);
		expect(performance.now() - t0).toBeLessThan(500);
	});
});

describe("scrubStack", () => {
	test("JSC-style stack (no message header) is kept and scrubbed", () => {
		const stack = "pushFile@plugin:engram-vault-sync:1:2\nflush@plugin:engram-vault-sync:3:4";
		expect(scrubStack(stack)).toBe(stack);
	});

	test("multi-line message header is dropped entirely", () => {
		const stack = `TypeError: bad\n${REL_CANARY}\nsecond line\n    at f (plugin:x:1:1)`;
		expect(scrubStack(stack)).toBe("TypeError\n    at f (plugin:x:1:1)");
	});
});

describe("call sites pass paths / use errMsg", () => {
	afterEach(() => {
		mock.restore();
	});

	test("invariant `check threw` detail goes through errMsg", async () => {
		const seen: string[] = [];
		const checker = new InvariantChecker({
			getContext: () => ({}) as never,
			onViolation: (v) => seen.push(v.detail),
			invariants: [
				{
					id: "explodes",
					description: "x",
					check: async () => {
						throw new Error(`ENOENT: no such file, open '${ABS_CANARY}'`);
					},
				},
			],
		} as never);
		await checker.checkAll();
		expect(seen).toHaveLength(1);
		expect(seen[0]).toContain("check threw");
		expect(seen[0]).not.toContain("canary-7d1");
	});

	test("auth onAuthInvalidated callback error goes through errMsg", async () => {
		const errSpy = spyOn(rlog(), "error");
		const refresh = mock(async () => {
			const e = new Error("Refresh failed: 401") as Error & { status?: number };
			e.status = 401;
			throw e;
		});
		const auth = new OAuthAuth(
			"engram_rt_dead",
			"vault-1",
			"user@test.com",
			refresh,
			undefined,
			null,
			0,
			() => {
				throw new Error(`EACCES: permission denied, open '${ABS_CANARY}'`);
			},
		);
		await expect(auth.getToken()).rejects.toThrow();
		const cbLine = errSpy.mock.calls.find((c) => String(c[1]).includes("onAuthInvalidated"));
		expect(cbLine).toBeDefined();
		expect(String(cbLine?.[1])).not.toContain("canary-7d1");
	});
});

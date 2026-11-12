// e2e-clerk test_85 shape (CI run 43120997451): B's channel is DOWN when a server-side
// edit lands AND when B edits locally, then B rejoins. Catch-up sees local+remote both
// diverged (drift-copy + converge) and the reconnect sweep pushes the note. Both edits
// must survive on the server; the e2e saw the server end on B's LOCAL-ONLY text.
//
// The INJECTED-FAULT variant (a stale pre-flush cachedRead; an injected fault, not a
// faithful model) is RED on origin/main and green with the applyLocalEdit reread fix
// (provider-registry.ts). The other two variants are green controls.

import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { destroyRemoteLog, formatAnomaly, initRemoteLog } from "../../src/remote-log";
import { Replica } from "./replica";
import { boot, cleanup } from "./scenarios";

afterAll(() => Replica.restoreGlobals());

const BASE = "# Missed Delivery\n\nbase-x\n";

/** The e2e's third writer: a REST write, no replica involved. */
function restWrite(t: Awaited<ReturnType<typeof boot>>, path: string, content: string): void {
	t.server.http({
		method: "POST",
		url: "/notes",
		body: JSON.stringify({ path, content }),
	} as never);
}

for (const variant of [
	"offline-edit",
	"push-modified-after-reconnect",
	"INJECTED-FAULT-stale-cachedRead-during-reconnect-push",
] as const) {
	test(`t85 ${variant}: server keeps BOTH`, async () => {
		const t = await boot(85, ["A", "B"], { genesisEmptyDoc: true });
		const [a, b] = t.replicas;
		const p = "t85.md";
		const localEdit = `${BASE}\nlocal-edit-x\n`;
		// Capture the always-on anomaly lines exactly as they would ship.
		const lines: string[] = [];
		initRemoteLog().anomaly = (category: string, code: string, counts) => {
			lines.push(`${category} ${formatAnomaly(code, counts)}`);
		};
		try {
			await a.createNote(p, BASE);
			await t.scheduler.drain();
			await b.goOffline();
			await t.scheduler.drain();
			restWrite(t, p, `${BASE}\nserver-edit-x\n`);
			await t.scheduler.drain();
			await b.editNote(p, localEdit);
			await t.scheduler.drain();
			const on = b.goOnline();
			let seq: Promise<unknown> = Promise.resolve();
			if (variant !== "offline-edit") {
				// main.ts:1405-1414: catch-up, then pushModifiedFiles with no wait for the
				// room-based converge. Step until the crdt topic joins, as that gate does.
				const priv = b as any;
				for (let i = 0; i < 500 && !priv.channel.isCrdtConnected(); i++) {
					// not-quiescent is expected for a 1-step drain
					await t.scheduler.drain(1).catch(() => {});
				}
				let stale = false;
				if (variant.startsWith("INJECTED")) {
					// INJECTED FAULT: every cachedRead of the note made BEFORE applyLocalEdit
					// starts returns the pre-flush 62-byte local text, as if routeModify read
					// disk before the converge flush wrote the merge and the flush plus
					// merge-base update finished before the diff ran. Reads made from inside
					// applyLocalEdit (its own reread) are truthful.
					const vault = priv.app.vault;
					const realRead = vault.cachedRead.bind(vault);
					vault.cachedRead = async (f: { path: string }) =>
						stale && f.path === p ? localEdit : realRead(f);
					const reg = priv.engine.crdt;
					const realApply = reg.applyLocalEdit.bind(reg);
					reg.applyLocalEdit = (...args: unknown[]) => {
						const r = realApply(...args);
						stale = false;
						return r;
					};
				}
				seq = (async () => {
					await b.engine.catchupViaSeqReplay();
					stale = true;
					await b.engine.pushModifiedFiles();
					stale = false;
				})();
			}
			await on;
			await t.scheduler.drain();
			await seq;
			await t.scheduler.drain();
			const srv = t.server.state().notes.get(p)?.content ?? "";
			expect(srv).toContain("server-edit-x");
			expect(srv).toContain("local-edit-x");
			const stale = lines.filter((l) => l.includes("stale_disk_snapshot"));
			if (variant.startsWith("INJECTED")) {
				// The reread saw bytes the caller's snapshot missed: exactly one line,
				// byte counts only (62-byte snapshot, 88-byte merge), no text, path or id.
				expect(stale).toHaveLength(1);
				expect(stale[0]).toMatch(
					/^crdt stale_disk_snapshot note=\d+ snapshot_bytes=\d+ reread_bytes=\d+$/,
				);
				expect(stale[0]).not.toContain("local-edit-x");
				expect(stale[0]).not.toContain("server-edit-x");
				expect(stale[0]).not.toContain("t85");
			} else {
				expect(stale).toHaveLength(0);
			}
		} finally {
			await destroyRemoteLog();
			cleanup(t);
		}
	});
}

// No edit loss the other way: the unconditional reread in applyLocalEdit must not drop a
// legitimate local edit made right after the converge flush settled.
test("t85 fresh local edit right after the flush is still delivered", async () => {
	const t = await boot(86, ["A", "B"], { genesisEmptyDoc: true });
	const [a, b] = t.replicas;
	const p = "t85b.md";
	try {
		await a.createNote(p, BASE);
		await t.scheduler.drain();
		await b.goOffline();
		await t.scheduler.drain();
		restWrite(t, p, `${BASE}\nserver-edit-x\n`);
		await t.scheduler.drain();
		await b.goOnline();
		await t.scheduler.drain();
		const merged = readFileSync(`${b.vaultDir}/${p}`, "utf8");
		await b.editNote(p, `${merged}\nfresh-x\n`);
		await t.scheduler.drain();
		const srv = t.server.state().notes.get(p)?.content ?? "";
		expect(srv).toContain("server-edit-x");
		expect(srv).toContain("fresh-x");
	} finally {
		cleanup(t);
	}
});

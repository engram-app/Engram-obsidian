/**
 * Diagnosability of mobile reports from Loki alone: client context on every
 * entry, and the forced (always-on) outcome lines. Everything here is counts
 * and slugs; a path or title cannot be expressed.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Platform } from "obsidian";
import { clientContext } from "../src/device-name";
import { PreviewUnavailableError } from "../src/preview-error";
import {
	initRemoteLog,
	type RemoteLogEntry,
	RemoteLogger,
	rlog,
	slugPart,
} from "../src/remote-log";
import {
	createFolderRenameReporter,
	createJoinReporter,
	reportPlanLoadFailure,
} from "../src/sync-diagnostics";
import { ManualTimeProvider } from "../src/time-provider";

let sent: RemoteLogEntry[] = [];

async function captured(): Promise<RemoteLogEntry[]> {
	await rlog().flush();
	return sent;
}

beforeEach(() => {
	sent = [];
	const logger = initRemoteLog();
	logger.configure(
		async (entries) => {
			sent.push(...entries);
		},
		"1.2.3",
		"mobile",
		{ os: "android", app_version: "1.8.10" },
	);
	// Diagnostics OFF: forced lines must still ship.
	logger.setEnabled(false);
});

afterEach(() => {
	Platform.isAndroidApp = false;
	Platform.isIosApp = false;
	Platform.isDesktop = true;
});

describe("client context", () => {
	test("rides on every entry, forced or not", async () => {
		const logger = new RemoteLogger();
		const out: RemoteLogEntry[] = [];
		logger.configure(
			async (e) => {
				out.push(...e);
			},
			"1.2.3",
			"mobile",
			{ os: "android", app_version: "1.8.10" },
		);
		logger.setEnabled(true);
		logger.warn("sync", "a");
		logger.anomaly("sync", "b");
		await logger.flush();
		expect(out.map((e) => e.context)).toEqual([
			{ os: "android", app_version: "1.8.10" },
			{ os: "android", app_version: "1.8.10" },
		]);
	});

	test("a mobile client with neither android nor ios flag is mobile_other, not desktop", () => {
		Platform.isMobile = true;
		Platform.isDesktop = false;
		try {
			expect(clientContext().os).toBe("mobile_other");
		} finally {
			Platform.isMobile = false;
		}
	});

	test("clientContext classifies android, ios and desktop from Platform flags", () => {
		Platform.isAndroidApp = true;
		expect(clientContext().os).toBe("android");
		Platform.isAndroidApp = false;
		Platform.isIosApp = true;
		expect(clientContext().os).toBe("ios");
		Platform.isIosApp = false;
		expect(clientContext().os).toBe("desktop");
		expect(clientContext().app_version).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("slugPart never lets free text through", () => {
		expect(slugPart("plan_limit")).toBe("plan_limit");
		expect(slugPart("Medical/Labs.md reason")).toBe("medical_labs_md_reason");
		expect(slugPart(undefined)).toBe("unknown");
		expect(slugPart("x".repeat(200)).length).toBeLessThanOrEqual(40);
	});
});

describe("preview failure", () => {
	test("typed reason ships forced, with which timeout part was missing", async () => {
		reportPlanLoadFailure(new PreviewUnavailableError("timeout", "missing catchup,live"));
		const [e] = await captured();
		expect(e.forced).toBe(true);
		expect(e.level).toBe("warn");
		expect(e.message).toBe(
			"preview_failed reason=timeout missing_catchup=true missing_manager=false missing_live=true",
		);
	});

	test("join rejection carries its reason slug", async () => {
		reportPlanLoadFailure(new PreviewUnavailableError("join_rejected", "plan_limit"));
		expect((await captured())[0].message).toBe(
			"preview_failed reason=join_rejected_plan_limit",
		);
	});

	test("an untyped error reports its http status, nothing else", async () => {
		reportPlanLoadFailure(
			Object.assign(new Error("Request failed, status 503 for /Secret/Path.md"), {
				status: 503,
			}),
		);
		const [e] = await captured();
		expect(e.message).toBe("preview_failed reason=other status=503");
		expect(e.message).not.toContain("Secret");
	});
});

describe("join outcome", () => {
	test("rejection is forced; first join and join-after-rejection are logged, steady rejoins are not", async () => {
		const r = createJoinReporter();
		r.rejected("plan_limit", 5);
		r.rejected("plan_limit", 5); // same reason retried: one line
		r.joined();
		r.joined(); // plain reconnect: silent
		const msgs = (await captured()).map((e) => e.message);
		expect(msgs).toEqual([
			"crdt_join_rejected reason=plan_limit min=5",
			"crdt_joined first=true after_rejections=2",
		]);
	});

	test("the very first join of a session is logged", async () => {
		const r = createJoinReporter();
		r.joined();
		expect((await captured())[0].message).toBe("crdt_joined first=true after_rejections=0");
	});

	test("alternating reasons log each reason once, not every flip", async () => {
		const r = createJoinReporter();
		for (let i = 0; i < 20; i++) {
			r.rejected(i % 2 ? "plan_limit" : "upgrade_required");
		}
		expect(await captured()).toHaveLength(2);
	});
});

describe("join reporter lifecycle", () => {
	test("clear() forgets the session: the next join is a first join again, seen reasons log again", async () => {
		const r = createJoinReporter();
		r.rejected("plan_limit", 1);
		r.joined();
		r.clear(); // vault switch or unload
		r.rejected("plan_limit", 2); // min differs only so the logger does not collapse the line
		r.rejected("other_reason"); // makes the second join line differ for the same reason
		r.joined();
		const msgs = (await captured()).map((e) => e.message);
		expect(
			msgs.filter((m) => m.startsWith("crdt_join_rejected reason=plan_limit")),
		).toHaveLength(2);
		expect(msgs.filter((m) => m.startsWith("crdt_joined first=true"))).toHaveLength(2);
	});
});

describe("join recovery", () => {
	test("a recovery after a logged rejection logs", async () => {
		const r = createJoinReporter();
		r.joined(); // first join
		r.rejected("plan_limit");
		r.joined();
		expect((await captured()).map((e) => e.message)).toEqual([
			"crdt_joined first=true after_rejections=0",
			"crdt_join_rejected reason=plan_limit",
			"crdt_joined first=false after_rejections=1",
		]);
	});
});

describe("folder rename", () => {
	const reporter = () => createFolderRenameReporter(new ManualTimeProvider());

	test("counts only: depth, children, same parent, no descendants", async () => {
		const r = reporter();
		r.rename("Projects/Old name", "Projects/New name", 4);
		r.clear();
		const [e] = await captured();
		expect(e.message).toBe(
			"folder_renamed children=4 descendants=0 same_parent=true depth_from=2 depth_to=2",
		);
		expect(e.message).not.toContain("Projects");
	});

	test("a rename burst (folder plus every nested subfolder) is ONE line with a descendant count", async () => {
		const r = reporter();
		r.rename("A", "B", 3);
		for (let i = 0; i < 50; i++) r.rename(`A/sub${i}`, `B/sub${i}`, 1);
		r.clear();
		const msgs = (await captured()).map((e) => e.message);
		expect(msgs).toHaveLength(1);
		expect(msgs[0]).toContain("descendants=50");
	});

	test("two unrelated renames are two lines", async () => {
		const r = reporter();
		r.rename("A", "B", 1);
		r.rename("C", "D", 2); // children differ only so the logger does not collapse the line
		r.clear();
		expect(await captured()).toHaveLength(2);
	});

	test("a separate rename inside the old folder right after renaming it is its own line", async () => {
		const r = reporter();
		r.rename("A", "B", 2);
		r.rename("A/x", "A/y", 1); // not the root's move applied to a descendant
		r.clear();
		expect(await captured()).toHaveLength(2);
	});

	test("the quiet timer flushes through the injected clock", async () => {
		const clock = new ManualTimeProvider();
		const r = createFolderRenameReporter(clock);
		r.rename("A", "B", 1);
		expect(await captured()).toHaveLength(0);
		clock.advance(1_001);
		expect(await captured()).toHaveLength(1);
	});
});

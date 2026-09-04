/**
 * Tests for sync-center-render — specifically the "Needs Pro" surface added
 * in Task 7.4 of the Free Tier launch. The Obsidian DOM helpers (createDiv /
 * createEl / createSpan) are stubbed lightly in tests/__mocks__/obsidian.ts;
 * we wrap them locally with a tree-tracking adapter so we can assert
 * structure + emitted text without needing real DOM.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { renderSyncCenter } from "../src/sync-center-render";
import type { SyncIssue } from "../src/types";

interface FakeEl {
	cls: string;
	tag: string;
	text: string;
	attrs: Record<string, string>;
	children: FakeEl[];
	/** The element this node was actually appended to. See `factory` below. */
	owner?: FakeEl;
}

function makeFakeEl(tag: string, opts?: { cls?: string; text?: string }): FakeEl {
	const el: FakeEl = {
		tag,
		cls: opts?.cls ?? "",
		text: opts?.text ?? "",
		attrs: {},
		children: [],
	};
	const factory = (childTag: string) => (childOpts?: { cls?: string; text?: string }) => {
		const child = makeFakeEl(childTag, childOpts);
		el.children.push(child);
		// `makeFakeEl` already bound the chainable API to the child. Re-assigning
		// the PARENT's methods here (as this used to) rebound every descendant's
		// factory to this `el`, so the whole tree rendered flat: a stat's label
		// landed as a SIBLING of its row rather than inside it. Nothing asserted
		// on structure, so it went unnoticed until a row had to be removed and
		// its label stayed behind.
		child.owner = el;
		return child as unknown as HTMLElement;
	};
	const methods = (target: FakeEl) => ({
		createDiv: (o?: { cls?: string; text?: string }) => factory("div")(o),
		createSpan: (o?: { cls?: string; text?: string }) => factory("span")(o),
		createEl: (t: string, o?: { cls?: string; text?: string }) => factory(t)(o),
		setText: (t: string) => {
			target.text = t;
			return target;
		},
		setAttribute: (k: string, v: string) => {
			target.attrs[k] = v;
			return target;
		},
		addClass: (c: string) => {
			target.cls = target.cls ? `${target.cls} ${c}` : c;
			return target;
		},
		addEventListener: () => {
			/* noop in tests */
		},
		empty: () => {
			target.children.length = 0;
		},
		// The stats panel drops its local note row once the server confirms the
		// same number, so the fake tree has to support detaching a node.
		remove: () => {
			const p = target.owner;
			if (p) p.children.splice(p.children.indexOf(target), 1);
		},
	});
	Object.assign(el, methods(el));
	return el;
}

/** Walk the rendered tree collecting all text fragments. */
function allText(el: FakeEl): string {
	const out: string[] = [];
	const visit = (n: FakeEl) => {
		if (n.text) out.push(n.text);
		for (const c of n.children) visit(c);
	};
	visit(el);
	return out.join(" | ");
}

/** Find the first element matching cls (anywhere in the subtree). */
function findByCls(el: FakeEl, cls: string): FakeEl | null {
	if (el.cls.split(" ").includes(cls)) return el;
	for (const c of el.children) {
		const hit = findByCls(c, cls);
		if (hit) return hit;
	}
	return null;
}

function findAllByCls(el: FakeEl, cls: string): FakeEl[] {
	const out: FakeEl[] = [];
	const visit = (n: FakeEl) => {
		if (n.cls.split(" ").includes(cls)) out.push(n);
		for (const c of n.children) visit(c);
	};
	visit(el);
	return out;
}

function makeIssue(overrides: Partial<SyncIssue> = {}): SyncIssue {
	const now = Date.now();
	return {
		path: "Assets/logo.png",
		kind: "attachment",
		category: "needs_pro",
		status: 402,
		message: "Engram limit: attachments_disabled",
		firstFailedAt: now,
		lastFailedAt: now,
		attempts: 1,
		...overrides,
	};
}

function makeMockPlugin(issues: SyncIssue[], planState?: unknown): any {
	// Hoisted so `resolveRemoteVaultName` below reads the SAME object the tests
	// mutate. Returning a fixed name instead would overwrite whatever a test
	// set, which is exactly the bug the resolve exists to fix.
	const settings: { vaultId: string; remoteVaultName?: string } = {
		vaultId: "1",
		remoteVaultName: "Vault",
	};
	return {
		// `getMarkdownFiles` is what the search-cap section counts. The real
		// vault has it; omitting it here meant the mock diverged from the
		// interface rather than the code being wrong.
		app: {
			vault: { getFiles: () => [], getMarkdownFiles: () => [], getName: () => "Vault" },
		},
		settings,
		// The Remote vault stat paints the cached name, then asks the server to
		// confirm it. Agreeing with the cache is the no-drift case; a test that
		// wants the correction overrides this.
		resolveRemoteVaultName: () => Promise.resolve(settings.remoteVaultName ?? null),
		syncEngine: {
			// Real engine has this (see main.ts, where it feeds the search panel's
			// cap hint). Defaults to null, which is the genuine pre-join state:
			// plan state arrives over the channel, so it IS absent for a moment.
			getPlanState: () => planState ?? null,
			getStatus: () => ({
				state: "idle",
				pending: 0,
				queued: 0,
				lastSync: "",
				error: undefined,
			}),
			// Matches the real engine: null when nothing is queued, which is the
			// state `getStatus` above reports.
			queuedReason: () => null,
			issues: {
				all: () => issues,
				count: (cat?: string) =>
					cat ? issues.filter((i) => i.category === cat).length : issues.length,
				byCategory: () => {
					const groups: Record<string, SyncIssue[]> = {};
					for (const i of issues) {
						const bucket = groups[i.category] ?? [];
						bucket.push(i);
						groups[i.category] = bucket;
					}
					return groups;
				},
			},
			ignoredFiles: { all: () => [], size: () => 0 },
			queue: { size: 0 },
			isSyncable: () => false,
			shouldIgnore: () => false,
			isBinaryFile: () => false,
			getLastSync: () => "",
		},
		syncLog: { entries: () => [], clear: () => {} },
		isLiveConnected: () => false,
	};
}

describe("renderSyncCenter — Needs attention cards", () => {
	let parent: FakeEl;

	beforeEach(() => {
		parent = makeFakeEl("div");
	});

	test("renders a needs-attention card with plain-language title + upgrade hint", () => {
		const plugin = makeMockPlugin([makeIssue()]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const text = allText(parent);
		expect(text).toContain("Attachments need a paid plan");
		expect(text.toLowerCase()).toContain("upgrade to sync");
	});

	test("renders the lock icon on the needs_pro card", () => {
		const plugin = makeMockPlugin([makeIssue()]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const icons = findAllByCls(parent, "engram-sync-center-card-icon");
		expect(icons.some((i) => i.text === "🔒")).toBe(true);
	});

	test("too_large gets its own card (different icon, no lock)", () => {
		const plugin = makeMockPlugin([
			makeIssue({ path: "Health/big.pdf", category: "too_large", status: 413 }),
		]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const icons = findAllByCls(parent, "engram-sync-center-card-icon");
		expect(icons.some((i) => i.text === "🔒")).toBe(false);
		expect(allText(parent)).toMatch(/Too large/);
	});

	test("needs_pro renders the plan section + remediation copy; too_large is a card", () => {
		const plugin = makeMockPlugin([
			makeIssue({ path: "Health/big.pdf", category: "too_large", status: 413 }),
			makeIssue({ path: "Assets/a.png", category: "needs_pro", status: 402 }),
		]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		// The dedicated calm section exists…
		expect(findByCls(parent, "engram-sync-center-plan-section")).not.toBeNull();
		// …and the needs_pro card lands in it (info variant, not the red card).
		const infoCards = findAllByCls(parent, "engram-sync-center-card-info");
		expect(infoCards.length).toBeGreaterThanOrEqual(1);

		const text = allText(parent);
		expect(text).toContain("Attachments need a paid plan");
		// too_large stays an attention card.
		const titles = findAllByCls(parent, "engram-sync-center-card-title");
		expect(titles.some((t) => t.text.includes("Too large"))).toBe(true);
	});

	test("a quota (informational) failure renders in the plan section as an info card", () => {
		const plugin = makeMockPlugin([
			makeIssue({ path: "Assets/big.png", category: "quota", status: 402 }),
		]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		expect(findByCls(parent, "engram-sync-center-plan-section")).not.toBeNull();
		expect(allText(parent)).toContain("Attachment storage full");
		// It's an info-styled card, not a red attention card.
		expect(findAllByCls(parent, "engram-sync-center-card-info").length).toBeGreaterThanOrEqual(
			1,
		);

		// With ONLY an informational issue, "Needs attention" shows its empty
		// placeholder — proving informational did not leak into it.
		const attentionSection = findByCls(parent, "engram-sync-center-attention-section");
		expect(attentionSection).not.toBeNull();
		expect(allText(parent)).toContain("Nothing needs your attention");
	});

	test("informational issues do NOT render under 'Retrying automatically'", () => {
		const plugin = makeMockPlugin([
			makeIssue({ path: "Assets/big.png", category: "quota", status: 402 }),
		]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const text = allText(parent);
		expect(text).not.toContain("Temporary errors");
		// Header counts it as a plan-skip, not "retrying" / "needs attention".
		expect(text).toContain("1 not on your plan");
		expect(text).not.toContain("needs attention");
		expect(text).not.toContain("1 retrying");
	});

	test("the plan section offers an Upgrade button, not a Retry/Dismiss", () => {
		const plugin = makeMockPlugin([makeIssue({ category: "needs_pro" })]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		expect(findByCls(parent, "engram-sync-center-plan-section")).not.toBeNull();
		const buttons = findAllByCls(parent, "mod-cta").filter((b) => b.text === "Upgrade");
		expect(buttons.length).toBeGreaterThanOrEqual(1);
		// No "Sync these now" button yet (deferred to a later task).
		const allButtons = findAllByCls(parent, "engram-sync-center-card-info").flatMap((c) =>
			findAllByCls(c, "mod-cta"),
		);
		expect(allButtons.every((b) => b.text !== "Sync these now")).toBe(true);
	});

	test("a transient (server) failure renders under 'Retrying automatically', not as a card", () => {
		const plugin = makeMockPlugin([
			makeIssue({ path: "Notes/x.md", kind: "note", category: "server", status: 502 }),
		]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const text = allText(parent);
		// Header badge + retrying-section body copy (section headings render via
		// Obsidian's Setting, which the test's allText doesn't capture).
		expect(text).toContain("1 retrying");
		expect(text).toContain("Temporary errors");
		// No actionable card for a transient failure.
		expect(findAllByCls(parent, "engram-sync-center-card")).toHaveLength(0);
	});

	test("renders frontmatter reason message and snippet, not just HTTP status", () => {
		const issue: SyncIssue = {
			path: "notes/broken.md",
			kind: "note",
			category: "frontmatter",
			message: "Frontmatter isn't valid YAML",
			parseReason: {
				code: "frontmatter_invalid_yaml",
				message: "Frontmatter isn't valid YAML",
				detail: { key: null, line: 2, snippet: "date:YYYY-MM-DD" },
			},
			firstFailedAt: Date.now(),
			lastFailedAt: Date.now(),
			attempts: 1,
		};
		const plugin = makeMockPlugin([issue]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const text = allText(parent);
		expect(text).toContain("Frontmatter isn't valid YAML");
		expect(text).toContain("date:YYYY-MM-DD");
	});

	test("a note_processing_failed issue renders under 'Needs attention', not 'Retrying automatically'", () => {
		const issue: SyncIssue = {
			path: "notes/broken.md",
			kind: "note",
			category: "other",
			message: "Processing failed",
			parseReason: {
				code: "note_processing_failed",
				message: "Processing failed",
				detail: null,
			},
			firstFailedAt: Date.now(),
			lastFailedAt: Date.now(),
			attempts: 1,
		};
		const plugin = makeMockPlugin([issue]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const text = allText(parent);
		expect(text).toContain("1 needs attention");
		expect(text).not.toContain("1 retrying");
		expect(text).not.toContain("Temporary errors");
		expect(text.toLowerCase()).not.toContain("retrying");
		expect(text).toContain("Note couldn't be processed");
	});

	test("a plain 'other' push error (no parse reason) still renders under 'Retrying automatically'", () => {
		const issue: SyncIssue = {
			path: "notes/push-fail.md",
			kind: "note",
			category: "other",
			status: 500,
			message: "Request failed, status 500",
			firstFailedAt: Date.now(),
			lastFailedAt: Date.now(),
			attempts: 1,
		};
		const plugin = makeMockPlugin([issue]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const text = allText(parent);
		expect(text).toContain("1 retrying");
		expect(text).toContain("Temporary errors");
	});
	// ── "Your plan" usage panel ────────────────────────────────────────────
	// Always shown once the tier is known, NOT only when over a cap. A Free
	// user at 300 of 2,000 previously saw nothing, so the first thing they
	// learned about the limit was a search quietly failing on a note they had
	// just written.

	const FREE_USAGE = {
		tier: "free",
		usage: {
			notes: { used: 300, limit: 10000 },
			vaults: { used: 1, limit: 1 },
			attachment_bytes: { used: 13_002_342, limit: 1_073_741_824 },
			indexed_notes: { used: 300, limit: 2000 },
			ai_searches: { used: null, limit: 20 },
		},
	};

	function withPlan(tier: string | null, usage: unknown = FREE_USAGE, reject = false) {
		const plugin = makeMockPlugin([], tier === null ? null : { tier, indexedNotesCap: 2000 });
		plugin.api = {
			getBillingUsage: () =>
				reject ? Promise.reject(new Error("offline")) : Promise.resolve(usage),
		};
		return plugin;
	}

	/** Let the getBillingUsage promise and its .then settle. */
	const settle = () => new Promise((r) => setTimeout(r, 0));

	test("shows a healthy Free vault instead of nothing", async () => {
		const plugin = withPlan("free");
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		await settle();

		const text = allText(parent);
		expect(text).toContain("300 / 2,000");
		expect(text).toContain("Notes searchable");
	});

	test("uses the Stats grid rather than a format of its own", async () => {
		const plugin = withPlan("free");
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		await settle();

		// Rows land in a `stats-grid` as `stat-label` / `stat-value` pairs, which
		// is what gives them the separator and spacing Stats already has.
		const labels = findAllByCls(parent, "engram-sync-center-stat-label").map((e) => e.text);
		expect(labels).toContain("Notes searchable");
		expect(labels).toContain("Notes on this device");
	});

	test("says which system each number describes", async () => {
		// The account rows and the device rows legitimately disagree (ignored
		// files, anything not yet pushed). A bare "Vault" or "Local notes" left
		// the user no way to tell that is expected rather than a sync fault.
		const plugin = withPlan("free");
		plugin.settings.remoteVaultName = "Engram Prod";
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		await settle();

		const labels = findAllByCls(parent, "engram-sync-center-stat-label").map((e) => e.text);
		expect(labels).toContain("Attachments on this device");
		expect(labels).toContain("Remote vault");
		// An API/log identifier, never a thing a user acts on. Still reachable
		// as the tooltip on the vault name in the Connection tab.
		expect(labels).not.toContain("Vault ID");
		expect(allText(parent)).toContain("Engram Prod");
	});

	test("corrects a stale cached vault name from the server", async () => {
		// The reported bug: re-point at a different vault and the panel keeps
		// showing the old name forever. `remoteVaultName` is a cache with no
		// invalidation, and the auth paths change vaults without setting it, so
		// reading the cache alone can only ever be wrong in one direction.
		const plugin = withPlan("free");
		plugin.settings.remoteVaultName = "Old Vault";
		plugin.resolveRemoteVaultName = () => Promise.resolve("New Vault");
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		await settle();

		expect(allText(parent)).toContain("New Vault");
		expect(allText(parent)).not.toContain("Old Vault");
	});

	test("keeps showing the cached name when the server cannot be reached", async () => {
		// Cosmetic data. An offline render showing the last known name beats one
		// showing an error, or a blank, where a name goes.
		const plugin = withPlan("free");
		plugin.settings.remoteVaultName = "Engram Prod";
		plugin.resolveRemoteVaultName = () => Promise.resolve("Engram Prod");
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		await settle();

		expect(allText(parent)).toContain("Engram Prod");
	});

	test("says 'not linked' rather than blank when there is no remote vault", async () => {
		const plugin = withPlan("free");
		plugin.settings.remoteVaultName = undefined;
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		await settle();
		expect(allText(parent)).toContain("not linked");
	});

	test("says nothing at all before plan state arrives", () => {
		// Plan state comes over the channel, so it IS null for a moment after
		// load and forever when signed out. No tier, no panel, no fetch.
		const plugin = withPlan(null);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		expect(allText(parent)).not.toContain("Notes searchable");
	});

	test("leaves the Upgrade CTA to the settings status bar", async () => {
		// Moved out of this panel deliberately. The status strip persists across
		// all four tabs, so the CTA no longer requires already being on the tab
		// that reports your limits. Coverage lives in settings-upgrade-cta.test.
		const plugin = withPlan("free");
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		await settle();
		expect(findAllByCls(parent, "mod-cta").some((b) => b.text === "Upgrade")).toBe(false);
	});

	test("drops the local note count once the server agrees with it", async () => {
		// Was the third row reading the same number as "Notes searchable" and
		// "Notes stored". It only carries information when it DISAGREES.
		const plugin = withPlan("free", {
			tier: "free",
			usage: { notes: { used: 0, limit: 10000 }, indexed_notes: { used: 0, limit: 2000 } },
		});
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		await settle();

		const labels = findAllByCls(parent, "engram-sync-center-stat-label").map((e) => e.text);
		expect(labels).not.toContain("Notes on this device");
		expect(labels).toContain("Notes stored");
	});

	test("keeps the local note count when it disagrees with the server", async () => {
		// The disagreement is the signal: something local is not yet pushed.
		const plugin = withPlan("free", {
			tier: "free",
			usage: { notes: { used: 297, limit: 10000 } },
		});
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		await settle();

		const labels = findAllByCls(parent, "engram-sync-center-stat-label").map((e) => e.text);
		expect(labels).toContain("Notes on this device");
	});

	test("does not push Upgrade at someone who already pays", async () => {
		const plugin = withPlan("pro", {
			tier: "pro",
			usage: { notes: { used: 1240, limit: null } },
		});
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		await settle();

		// Bare count on an unlimited plan, no "/ unlimited" suffix.
		expect(allText(parent)).toContain("1,240");
	});

	test("a failed usage read does not masquerade as a sync problem", async () => {
		const plugin = withPlan("free", FREE_USAGE, true);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});
		await settle();

		// Reported as an ordinary stat row, not an error banner: an advisory
		// read failing must not look like sync is broken.
		const labels = findAllByCls(parent, "engram-sync-center-stat-label").map((e) => e.text);
		expect(labels).toContain("Plan usage");
		expect(labels).not.toContain("Notes searchable");
		expect(allText(parent)).toContain("unavailable");
	});
});

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
		// Attach the same chainable API for further nesting.
		Object.assign(child, methods(child));
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

function makeMockPlugin(issues: SyncIssue[]): any {
	return {
		app: { vault: { getFiles: () => [], getName: () => "Vault" } },
		settings: { vaultId: "1", remoteVaultName: "Vault" },
		syncEngine: {
			getStatus: () => ({
				state: "idle",
				pending: 0,
				queued: 0,
				lastSync: "",
				error: undefined,
			}),
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

	test("needs_pro card appears before too_large (CATEGORY_ORDER)", () => {
		const plugin = makeMockPlugin([
			makeIssue({ path: "Health/big.pdf", category: "too_large", status: 413 }),
			makeIssue({ path: "Assets/a.png", category: "needs_pro", status: 402 }),
		]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const titles = findAllByCls(parent, "engram-sync-center-card-title");
		expect(titles.length).toBeGreaterThanOrEqual(2);
		expect(titles[0].text).toContain("Attachments need a paid plan");
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
});

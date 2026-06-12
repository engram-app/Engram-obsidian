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

describe("renderSyncCenter — Needs Pro surface", () => {
	let parent: FakeEl;

	beforeEach(() => {
		parent = makeFakeEl("div");
	});

	test("renders the Needs Pro group label when an issue has category needs_pro", () => {
		const plugin = makeMockPlugin([makeIssue()]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const text = allText(parent);
		expect(text).toContain("Needs Pro");
		expect(text.toLowerCase()).toContain("upgrade to sync attachments");
	});

	test("renders a lock icon span for needs_pro rows", () => {
		const plugin = makeMockPlugin([makeIssue()]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const lockIcons = findAllByCls(parent, "engram-needs-pro-icon");
		expect(lockIcons).toHaveLength(1);
		expect(lockIcons[0].text).toBe("🔒");
		expect(lockIcons[0].attrs["aria-label"]).toBe("Upgrade to sync attachments");
	});

	test("non-needs_pro issues do NOT get a lock icon", () => {
		const plugin = makeMockPlugin([
			makeIssue({ path: "Health/big.pdf", category: "too_large", status: 413 }),
		]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const lockIcons = findAllByCls(parent, "engram-needs-pro-icon");
		expect(lockIcons).toHaveLength(0);
		// And the original "Too large" group label is still rendered.
		expect(allText(parent)).toMatch(/Too large/);
	});

	test("Needs Pro group appears before other categories in CATEGORY_ORDER", () => {
		const plugin = makeMockPlugin([
			makeIssue({ path: "Assets/a.png", category: "needs_pro", status: 402 }),
			makeIssue({ path: "Health/big.pdf", category: "too_large", status: 413 }),
		]);
		renderSyncCenter(parent as unknown as HTMLElement, plugin, () => {});

		const groupHeads = findAllByCls(parent, "engram-sync-center-group-head");
		expect(groupHeads.length).toBeGreaterThanOrEqual(2);
		// Needs Pro must render first
		expect(groupHeads[0].text).toContain("Needs Pro");
	});
});

/**
 * The Upgrade CTA lives in the settings status strip, not in the Sync Center.
 *
 * It used to be appended to the bottom of the Sync Center's usage card, after
 * the async usage fetch resolved. That put the one conversion affordance in
 * the plugin behind two conditions: the user had to already be on the Sync
 * Center tab, and had to wait for a network round-trip. The status strip is
 * the only chrome that persists across all four tabs, and it renders
 * synchronously off plan state the channel already delivered.
 *
 * Object.create(prototype) pattern (see settings-gate-rerender.test.ts) so the
 * real renderStatus runs against a bare fake plugin, no Obsidian DOM.
 */
import { describe, expect, test } from "bun:test";
import { EngramSyncSettingTab } from "../src/settings";

interface FakeEl {
	cls: string;
	text: string;
	children: FakeEl[];
	isConnected: boolean;
}

function makeFakeEl(cls = ""): FakeEl {
	const el: FakeEl = { cls, text: "", children: [], isConnected: true };
	const add = (o?: { cls?: string; text?: string }) => {
		const child = makeFakeEl(o?.cls ?? "");
		child.text = o?.text ?? "";
		el.children.push(child);
		return Object.assign(child, methods(child));
	};
	const methods = (t: FakeEl) => ({
		createSpan: add,
		createDiv: add,
		createEl: (_tag: string, o?: { cls?: string; text?: string }) => add(o),
		setText: (s: string) => {
			t.text = s;
		},
		addClass: () => t,
		addClasses: () => t,
		addEventListener: () => {},
		empty: () => {
			t.children.length = 0;
		},
	});
	return Object.assign(el, methods(el));
}

function renderWith(tier: string | undefined): FakeEl {
	const tab = Object.create(EngramSyncSettingTab.prototype) as any;
	const statusEl = makeFakeEl();
	tab.statusContainerEl = statusEl;
	tab.plugin = {
		// Signed in and live, so the status strip takes its plainest branch and
		// the only thing under test is the CTA.
		settings: { apiUrl: "https://api.example.com", apiKey: "k" },
		isLiveConnected: () => true,
		syncEngine: {
			getStatus: () => ({ state: "idle", lastSync: "" }),
			isSyncBlocked: () => false,
			getPlanState: () => (tier ? { tier } : null),
		},
	};
	tab.renderStatus();
	return statusEl;
}

const hasUpgrade = (el: FakeEl): boolean =>
	el.children.some((c) => c.cls.includes("engram-status-upgrade-btn") && c.text === "Upgrade");

describe("settings status strip — Upgrade CTA", () => {
	test("offers Upgrade on Free", () => {
		expect(hasUpgrade(renderWith("free"))).toBe(true);
	});

	test("does not push Upgrade at someone who already pays", () => {
		expect(hasUpgrade(renderWith("starter"))).toBe(false);
		expect(hasUpgrade(renderWith("pro"))).toBe(false);
	});

	test("stays quiet until plan state arrives", () => {
		// Plan state comes over the channel, so it is genuinely absent for a beat
		// after load and for the whole session when signed out. Guessing "free"
		// there would flash an upgrade prompt at a paying user on every open.
		expect(hasUpgrade(renderWith(undefined))).toBe(false);
	});
});

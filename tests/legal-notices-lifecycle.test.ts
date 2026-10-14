/**
 * The plugin's legal-notice toasts across a reload. Object.create(prototype)
 * pattern (see sync-setup-reprompt.test.ts).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { LegalNotice } from "../src/legal-notices";
import EngramSyncPlugin from "../src/main";
import { __noticeCapture } from "./__mocks__/obsidian";

type Lifecycle = {
	showLegalNotices(): Promise<void>;
	dismissLegalNotices(): void;
	unloaded: boolean;
};

const material: LegalNotice = {
	document: "terms_of_service",
	version: "2026-12-01",
	effective_date: "2026-12-01",
	material: true,
	changelog: null,
	url: "https://engram.page/terms",
	accept_url: "https://app.engram.page/onboard/agreement",
};

(globalThis as Record<string, unknown>).createFragment = () => ({
	appendText: () => {},
	createEl: () => ({}),
});

function plugin(fetch: () => Promise<LegalNotice[]>) {
	let saves = 0;
	const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
		settings: { seenLegalNotices: [] },
		legalNoticeToasts: new Map(),
		unloaded: false,
		hasAuthConfigured: () => true,
		api: { getLegalNotices: fetch },
		syncEngine: { getLastSync: () => 0 },
		savePluginData: async () => {
			saves++;
		},
	}) as unknown as Lifecycle;
	return { fake, saves: () => saves };
}

beforeEach(() => {
	__noticeCapture.notices.length = 0;
});

describe("legal notices across unload", () => {
	test("a fetch that resolves after unload neither saves nor shows a toast", async () => {
		let resolve: (n: LegalNotice[]) => void = () => {};
		const { fake, saves } = plugin(() => new Promise((r) => (resolve = r)));
		const pending = fake.showLegalNotices();
		fake.unloaded = true;
		resolve([material]);
		await pending;
		expect(saves()).toBe(0);
		expect(__noticeCapture.notices).toHaveLength(0);
	});

	test("a repeated material notice replaces its toast instead of stacking", async () => {
		const { fake } = plugin(async () => [material]);
		await fake.showLegalNotices();
		await fake.showLegalNotices();
		expect(__noticeCapture.notices.map((n) => n.hidden)).toEqual([true, false]);
	});

	test("unload hides every legal toast", async () => {
		const { fake } = plugin(async () => [material]);
		await fake.showLegalNotices();
		fake.dismissLegalNotices();
		expect(__noticeCapture.notices.every((n) => n.hidden)).toBe(true);
	});
});

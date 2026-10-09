/**
 * Re-prompting a user who closed the first-sync modal without choosing (#527).
 *
 * The gate stays closed until a direction is picked, and the only way back
 * was the status bar item, which Obsidian mobile does not render. Prod
 * 2026-10-09: a new user linked on mobile, closed the modal, and nothing in
 * their vault ever synced.
 *
 * Object.create(prototype) pattern (see sync-gate-closed-notice.test.ts).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import de from "../src/i18n/locale/de";
import es from "../src/i18n/locale/es";
import fr from "../src/i18n/locale/fr";
import it from "../src/i18n/locale/it";
import ja from "../src/i18n/locale/ja";
import ko from "../src/i18n/locale/ko";
import pt from "../src/i18n/locale/pt";
import ru from "../src/i18n/locale/ru";
import zh from "../src/i18n/locale/zh";
import zhTW from "../src/i18n/locale/zh-TW";
import EngramSyncPlugin from "../src/main";
import { __noticeCapture } from "./__mocks__/obsidian";

type Reprompt = {
	notifySetupUnfinished(): void;
	maybeRepromptSetupOnResume(now: number): void;
	dismissSetupNotice(): void;
};

const signedIn = { apiUrl: "https://engram.example.com", apiKey: "k", vaultId: "v1" };

function plugin(opts: { settings?: Record<string, unknown>; blocked?: boolean } = {}) {
	const opened: string[] = [];
	const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
		settings: opts.settings ?? signedIn,
		syncEngine: { isSyncBlocked: () => opts.blocked ?? true },
		doSyncWithFirstSyncCheck: async () => {
			opened.push("preview");
		},
	}) as unknown as Reprompt;
	return { fake, opened };
}

describe("notice after closing the modal without a choice", () => {
	beforeEach(() => {
		__noticeCapture.notices.length = 0;
	});

	test("stays up until dismissed", () => {
		plugin().fake.notifySetupUnfinished();
		expect(__noticeCapture.notices).toHaveLength(1);
		expect(__noticeCapture.notices[0].duration).toBe(0);
	});

	test("does not point at the status bar, which mobile does not have", () => {
		plugin().fake.notifySetupUnfinished();
		expect(__noticeCapture.notices[0].message).not.toMatch(/status bar/i);
	});

	test("its link reopens the sync preview and hides the notice", () => {
		const { fake, opened } = plugin();
		fake.notifySetupUnfinished();
		const n = __noticeCapture.notices[0];
		expect(n.buttons).toHaveLength(1);
		expect(n.buttons[0].text).toBe("Finish sync setup");
		n.buttons[0].click();
		expect(opened).toEqual(["preview"]);
		expect(n.hidden).toBe(true);
	});

	test("a second call replaces the first instead of stacking", () => {
		const { fake } = plugin();
		fake.notifySetupUnfinished();
		fake.notifySetupUnfinished();
		expect(__noticeCapture.notices[0].hidden).toBe(true);
		expect(__noticeCapture.notices[1].hidden).toBe(false);
	});

	test("dismissSetupNotice hides it once sync is set up", () => {
		const { fake } = plugin();
		fake.notifySetupUnfinished();
		fake.dismissSetupNotice();
		expect(__noticeCapture.notices[0].hidden).toBe(true);
	});

	test("has no em dash in English or any translation", () => {
		plugin().fake.notifySetupUnfinished();
		const n = __noticeCapture.notices[0];
		for (const key of [n.message, n.buttons[0].text]) {
			expect(key).not.toContain("—");
			for (const dict of [de, es, fr, it, ja, ko, pt, ru, zh, zhTW]) {
				const value = (dict as Record<string, unknown>)[key];
				expect(typeof value).toBe("string");
				expect(value as string).not.toContain("—");
			}
		}
	});
});

describe("reopen the preview when the app comes back", () => {
	const MIN = 60_000;

	test("reopens while signed in and the gate is closed", () => {
		const { fake, opened } = plugin();
		fake.maybeRepromptSetupOnResume(100 * MIN);
		expect(opened).toEqual(["preview"]);
	});

	test("at most once per 10 minutes", () => {
		const { fake, opened } = plugin();
		fake.maybeRepromptSetupOnResume(100 * MIN);
		fake.maybeRepromptSetupOnResume(105 * MIN);
		fake.maybeRepromptSetupOnResume(109 * MIN);
		expect(opened).toHaveLength(1);
		fake.maybeRepromptSetupOnResume(110 * MIN);
		expect(opened).toHaveLength(2);
	});

	test("stays quiet once sync is set up", () => {
		const { fake, opened } = plugin({ blocked: false });
		fake.maybeRepromptSetupOnResume(100 * MIN);
		expect(opened).toHaveLength(0);
	});

	test("stays quiet after sign-out (sign-out closes the gate on purpose)", () => {
		const { fake, opened } = plugin({ settings: { apiUrl: "https://engram.example.com" } });
		fake.maybeRepromptSetupOnResume(100 * MIN);
		expect(opened).toHaveLength(0);
	});
});

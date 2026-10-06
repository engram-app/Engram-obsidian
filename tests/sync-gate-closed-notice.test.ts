/**
 * The "sync is paused" notice main.ts shows when an edit meets a closed gate.
 *
 * Signing out closes the gate too (no fingerprint), so a user who signed out
 * to set up a different vault and then tidied files got told their edits were
 * "not synced", which is the point of being signed out. The notice is only
 * true, and only actionable, while signed in.
 *
 * Object.create(prototype) pattern (see main-sync-error.test.ts): the real
 * private method runs against a bare fake `this`.
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

type WithNotice = { notifySyncGateClosed(): void };

function plugin(settings: Record<string, unknown>) {
	const opened: string[] = [];
	const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
		settings,
		openConnectionSettings: () => opened.push("connection"),
	}) as unknown as WithNotice;
	return { fake, opened };
}

const signedIn = { apiUrl: "https://engram.example.com", apiKey: "k", vaultId: "v1" };

describe("sync-paused notice", () => {
	beforeEach(() => {
		__noticeCapture.notices.length = 0;
	});

	test("fires while signed in", () => {
		plugin(signedIn).fake.notifySyncGateClosed();
		expect(__noticeCapture.notices).toHaveLength(1);
		expect(__noticeCapture.notices[0].message).toMatch(/sync is paused/);
	});

	test("stays quiet after sign-out", () => {
		plugin({ apiUrl: "https://engram.example.com", apiKey: "" }).fake.notifySyncGateClosed();
		plugin({}).fake.notifySyncGateClosed();
		expect(__noticeCapture.notices).toHaveLength(0);
	});

	test("offers a link to the plugin settings, not a Resume button", () => {
		const { fake, opened } = plugin(signedIn);
		fake.notifySyncGateClosed();
		const n = __noticeCapture.notices[0];
		expect(n.buttons).toHaveLength(1);
		const link = n.buttons[0];
		expect(link.tag).toBe("a");
		expect(link.text).toBe("Open Engram settings");

		link.click();
		expect(opened).toEqual(["connection"]);
		expect(n.hidden).toBe(true);
	});

	test("has no em dash in English or any translation", () => {
		plugin(signedIn).fake.notifySyncGateClosed();
		const key = __noticeCapture.notices[0].message;
		expect(key).not.toContain("—");
		for (const dict of [de, es, fr, it, ja, ko, pt, ru, zh, zhTW]) {
			const value = (dict as Record<string, unknown>)[key];
			expect(typeof value).toBe("string");
			expect(value as string).not.toContain("—");
		}
	});
});

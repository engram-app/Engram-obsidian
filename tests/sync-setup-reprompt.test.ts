/**
 * Re-prompting a user who closed the first-sync modal without choosing (#527).
 *
 * The gate stays closed until a direction is picked, and the only way back
 * was the status bar item, which Obsidian mobile does not render. Prod
 * 2026-10-09: a new user linked, closed the modal, and nothing in their
 * vault ever synced.
 *
 * Object.create(prototype) pattern (see sync-gate-closed-notice.test.ts).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
import { computeSyncFingerprint } from "../src/sync-fingerprint";
import { __noticeCapture, Platform } from "./__mocks__/obsidian";

type Reprompt = {
	notifySetupUnfinished(): void;
	maybeRepromptSetupOnResume(now: number): void;
	applySyncGate(): Promise<boolean>;
	onunload(): void;
	syncGateAcceptedFor: string | null;
	openPreviewModal: object | null;
};

const signedIn = { apiUrl: "https://engram.example.com", apiKey: "k", vaultId: "v1" };

function plugin(
	opts: {
		settings?: Record<string, unknown>;
		blocked?: boolean;
		acceptedFor?: string | null;
	} = {},
) {
	const opened: Array<{ startInVaultPicker?: boolean }> = [];
	let blocked = opts.blocked ?? true;
	const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
		settings: opts.settings ?? signedIn,
		syncGateAcceptedFor: opts.acceptedFor ?? null,
		openPreviewModal: null,
		syncEngine: {
			isSyncBlocked: () => blocked,
			setSyncBlocked: (b: boolean) => {
				blocked = b;
			},
			getStatus: () => ({}),
			replayGateJournal: async () => {},
		},
		updateStatusBar: () => {},
		doSyncWithFirstSyncCheck: async (o: { startInVaultPicker?: boolean } = {}) => {
			opened.push(o);
		},
	}) as unknown as Reprompt;
	return { fake, opened };
}

beforeEach(() => {
	__noticeCapture.notices.length = 0;
});

describe("notice after closing the modal without a choice", () => {
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
		expect(opened).toHaveLength(1);
		expect(n.hidden).toBe(true);
	});

	test("its link opens the vault picker when no vault is selected", () => {
		const { fake, opened } = plugin({ settings: { ...signedIn, vaultId: null } });
		fake.notifySetupUnfinished();
		__noticeCapture.notices[0].buttons[0].click();
		expect(opened).toEqual([{ startInVaultPicker: true }]);
	});

	test("its link keeps the notice while a preview is already open", () => {
		const { fake, opened } = plugin();
		fake.notifySetupUnfinished();
		fake.openPreviewModal = {};
		__noticeCapture.notices[0].buttons[0].click();
		expect(opened).toHaveLength(0);
		expect(__noticeCapture.notices[0].hidden).toBe(false);
	});

	test("a second call replaces the first instead of stacking", () => {
		const { fake } = plugin();
		fake.notifySetupUnfinished();
		fake.notifySetupUnfinished();
		expect(__noticeCapture.notices[0].hidden).toBe(true);
		expect(__noticeCapture.notices[1].hidden).toBe(false);
	});

	test("clears when the gate opens for an already-accepted vault", async () => {
		const fp = await computeSyncFingerprint(signedIn as never);
		const { fake } = plugin({ acceptedFor: fp });
		fake.notifySetupUnfinished();
		expect(await fake.applySyncGate()).toBe(true);
		expect(__noticeCapture.notices[0].hidden).toBe(true);
	});

	test("clears on sign-out", async () => {
		const { fake } = plugin({ settings: { apiUrl: "https://engram.example.com" } });
		fake.notifySetupUnfinished();
		await fake.applySyncGate();
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

describe("reopen the preview when the mobile app comes back", () => {
	const MIN = 60_000;
	beforeEach(() => {
		Platform.isMobile = true;
	});
	afterEach(() => {
		Platform.isMobile = false;
	});

	test("reopens while signed in and setup was never finished", () => {
		const { fake, opened } = plugin();
		fake.maybeRepromptSetupOnResume(100 * MIN);
		expect(opened).toHaveLength(1);
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

	test("a resume while a preview is open does not use up the window", () => {
		const { fake, opened } = plugin();
		fake.openPreviewModal = {};
		fake.maybeRepromptSetupOnResume(100 * MIN);
		fake.openPreviewModal = null;
		fake.maybeRepromptSetupOnResume(102 * MIN);
		expect(opened).toHaveLength(1);
	});

	test("opens the vault picker when no vault is selected", () => {
		const { fake, opened } = plugin({ settings: { ...signedIn, vaultId: null } });
		fake.maybeRepromptSetupOnResume(100 * MIN);
		expect(opened).toEqual([{ startInVaultPicker: true }]);
	});

	test("stays quiet once sync is set up", () => {
		const { fake, opened } = plugin({ blocked: false });
		fake.maybeRepromptSetupOnResume(100 * MIN);
		expect(opened).toHaveLength(0);
	});

	test("stays quiet for a vault that synced before (paused, not unfinished)", () => {
		const { fake, opened } = plugin({ acceptedFor: "old-fingerprint" });
		fake.maybeRepromptSetupOnResume(100 * MIN);
		expect(opened).toHaveLength(0);
	});

	test("stays quiet after sign-out (sign-out closes the gate on purpose)", () => {
		const { fake, opened } = plugin({ settings: { apiUrl: "https://engram.example.com" } });
		fake.maybeRepromptSetupOnResume(100 * MIN);
		expect(opened).toHaveLength(0);
	});

	test("stays quiet on desktop, where a modal would steal focus", () => {
		Platform.isMobile = false;
		const { fake, opened } = plugin();
		fake.maybeRepromptSetupOnResume(100 * MIN);
		expect(opened).toHaveLength(0);
	});
});

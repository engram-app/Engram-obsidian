/**
 * Progressive disclosure on the Connection tab.
 *
 * Signing in and picking a vault are impossible without a server to do them
 * against, so self-host starts with the URL field alone rather than three
 * sections the user cannot act on yet.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { __settingCapture, makeEl } from "obsidian";
import { renderConnectionTab } from "../src/tabs/connection-tab";

function ctxFor(opts: {
	backendMode: "cloud" | "selfhost";
	apiUrl: string;
	refreshToken?: string;
	syncBlocked?: boolean;
}) {
	const containerEl: any = makeEl();
	const plugin: any = {
		settings: {
			backendMode: opts.backendMode,
			apiUrl: opts.apiUrl,
			apiKey: "",
			refreshToken: opts.refreshToken ?? "",
		},
		// renderVaultSection fetches the vault list on render.
		api: { listVaults: async () => [] },
		noteStream: {},
		saveSettings: async () => {},
		hasAuthConfigured: () => Boolean(opts.apiUrl && opts.refreshToken),
		syncEngine: { isSyncBlocked: () => opts.syncBlocked ?? false },
		doSyncWithFirstSyncCheck: mock(async () => {}),
	};
	return { ctx: { containerEl, app: {}, plugin, redisplay: () => {} } as any };
}

const names = (): string => __settingCapture.names.join("|");

beforeEach(() => {
	__settingCapture.names.length = 0;
	__settingCapture.texts.length = 0;
	__settingCapture.buttons.length = 0;
});

describe("connection tab disclosure", () => {
	test("self-host with no URL hides auth and vault", () => {
		renderConnectionTab(ctxFor({ backendMode: "selfhost", apiUrl: "" }).ctx);
		expect(names()).toMatch(/Engram URL/i);
		expect(names()).not.toMatch(/Authentication/i);
	});

	// Cloud has no URL step — the address is fixed — so it must disclose
	// immediately or a cloud user sees an empty tab.
	test("cloud discloses immediately", () => {
		renderConnectionTab(ctxFor({ backendMode: "cloud", apiUrl: "" }).ctx);
		expect(names()).toMatch(/Authentication|Sign in/i);
	});

	// The trap this design has to avoid: disclosure keys on "a URL is
	// configured", NOT on whether the server answers right now. Otherwise a
	// brief outage makes the auth and vault sections vanish — the exact screen
	// a user in that state most needs.
	test("a configured URL keeps sections visible regardless of reachability", () => {
		renderConnectionTab(
			ctxFor({ backendMode: "selfhost", apiUrl: "http://127.0.0.1:4000" }).ctx,
		);
		expect(names()).toMatch(/Authentication|Sign in/i);
	});

	test("a blocked gate surfaces the finish-setup row", () => {
		renderConnectionTab(
			ctxFor({
				backendMode: "selfhost",
				apiUrl: "http://127.0.0.1:4000",
				refreshToken: "rt",
				syncBlocked: true,
			}).ctx,
		);
		expect(names()).toMatch(/Finish sync setup/i);
	});

	test("an open gate does not nag", () => {
		renderConnectionTab(
			ctxFor({
				backendMode: "selfhost",
				apiUrl: "http://127.0.0.1:4000",
				refreshToken: "rt",
				syncBlocked: false,
			}).ctx,
		);
		expect(names()).not.toMatch(/Finish sync setup/i);
	});
});

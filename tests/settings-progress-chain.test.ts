/**
 * Tests: the settings pane's sync-progress wiring must CHAIN onto
 * SyncEngine.onSyncProgress (a single mutable slot with multiple writers),
 * never clobber it, and must detach cleanly on hide().
 *
 * The bug this locks in: renderContent() bare-assigned the slot, so opening
 * settings mid-sync froze the open SyncProgressModal (its wrapper was
 * replaced), and hide() never cleared the assignment, so a closure over the
 * detached settings DOM kept firing on every future sync.
 *
 * Uses the Object.create(prototype) pattern (see main-catchup-wiring.test.ts)
 * so the real install/uninstall methods run against a bare fake plugin.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { EngramSyncSettingTab } from "../src/settings";

type ProgressCb = ((p: unknown) => void) | null;

type TabUnderTest = {
	installProgressBar(render: (p: unknown) => void): void;
	uninstallProgressBar(): void;
	plugin: { syncEngine: { onSyncProgress: ProgressCb } };
};

function makeTab(): TabUnderTest {
	const tab = Object.create(EngramSyncSettingTab.prototype) as TabUnderTest;
	(tab as unknown as { plugin: unknown }).plugin = { syncEngine: { onSyncProgress: null } };
	return tab;
}

describe("settings progress-bar chaining", () => {
	let seen: string[];
	beforeEach(() => {
		seen = [];
	});

	test("chains onto an existing callback instead of clobbering it", () => {
		const tab = makeTab();
		tab.plugin.syncEngine.onSyncProgress = () => seen.push("modal");
		tab.installProgressBar(() => seen.push("settings"));
		tab.plugin.syncEngine.onSyncProgress?.({});
		expect(seen).toContain("settings");
		expect(seen).toContain("modal");
	});

	test("uninstall restores the previous callback", () => {
		const tab = makeTab();
		const prev = () => seen.push("modal");
		tab.plugin.syncEngine.onSyncProgress = prev;
		tab.installProgressBar(() => seen.push("settings"));
		tab.uninstallProgressBar();
		expect(tab.plugin.syncEngine.onSyncProgress).toBe(prev);
	});

	test("re-render replaces the settings hook, it does not stack", () => {
		const tab = makeTab();
		tab.installProgressBar(() => seen.push("first-render"));
		tab.installProgressBar(() => seen.push("second-render"));
		tab.plugin.syncEngine.onSyncProgress?.({});
		expect(seen).toEqual(["second-render"]);
	});

	test("hide() mid-sync under a chained modal: settings goes silent, the modal keeps updating", () => {
		const tab = makeTab();
		const engine = tab.plugin.syncEngine;
		tab.installProgressBar(() => seen.push("settings"));
		// runSyncWithProgress chains on top of whatever is installed:
		const prev = engine.onSyncProgress;
		engine.onSyncProgress = (p) => {
			seen.push("modal");
			prev?.(p);
		};
		// user closes settings while the sync runs
		tab.uninstallProgressBar();
		engine.onSyncProgress?.({});
		expect(seen).toEqual(["modal"]); // no detached-DOM settings render
		// the modal's finally restores what it captured; settings stays silent
		engine.onSyncProgress = prev;
		engine.onSyncProgress?.({});
		expect(seen).toEqual(["modal"]);
	});
});

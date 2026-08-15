/**
 * Consent boundary for the sync-timeline recorder.
 *
 * The recorder's `receive` seam stores whole inbound wire frames, and a Yjs
 * frame carries the note body inside it — the replayer needs exactly that
 * (tests/helpers/replay.ts). Every other seam records a length or a hash.
 *
 * So recording is the one piece of instrumentation that captures note CONTENT,
 * and it must not ride the Diagnostics switch: that switch ships to the server
 * and its description promises "metadata only, never note content". These tests
 * pin the two properties that keep those promises true — recording is off until
 * asked for, and it is asked for in words that say "content".
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { __settingCapture, makeEl } from "obsidian";
import { renderAdvancedTab } from "../src/tabs/advanced-tab";
import { DEFAULT_SETTINGS } from "../src/types";

function render(opts: { diagnosticsEnabled: boolean; syncRecordingEnabled?: boolean }) {
	const containerEl: any = makeEl();
	const plugin: any = {
		settings: {
			...DEFAULT_SETTINGS,
			diagnosticsEnabled: opts.diagnosticsEnabled,
			syncRecordingEnabled: opts.syncRecordingEnabled ?? false,
		},
		// renderAdvancedTab also draws the ignore-pattern warnings, which probe
		// the vault for known-problematic folders. Empty vault = no warnings.
		app: { vault: { getFiles: () => [], getFolderByPath: () => null } },
		saveSettings: async () => {},
		manifest: { version: "0.0.0" },
	};
	renderAdvancedTab({ containerEl, app: plugin.app, plugin, redisplay: () => {} } as any);
	return { plugin, containerEl };
}

beforeEach(() => {
	__settingCapture.names.length = 0;
	__settingCapture.descs.length = 0;
});

const names = () => __settingCapture.names.join("|");

describe("sync recording consent", () => {
	// The property everything else rests on. A recorder that defaults ON would
	// be capturing note content from first launch, with no one having agreed.
	test("recording is OFF by default", () => {
		expect(DEFAULT_SETTINGS.syncRecordingEnabled).toBe(false);
	});

	// Its own switch, NOT diagnosticsEnabled. Folding it in would mean a user
	// who turned on Diagnostics — described as "metadata only, never note
	// content" — silently started recording note text.
	test("is a separate setting from diagnostics", () => {
		expect(DEFAULT_SETTINGS.syncRecordingEnabled).not.toBe(undefined);
		expect("diagnosticsEnabled" in DEFAULT_SETTINGS).toBe(true);
		expect(DEFAULT_SETTINGS.diagnosticsEnabled).toBe(false);
	});

	test("no recording toggle is offered until diagnostics are on", () => {
		render({ diagnosticsEnabled: false });
		expect(names()).not.toContain("Record sync timeline");
	});

	test("the toggle appears once diagnostics are on", () => {
		render({ diagnosticsEnabled: true });
		expect(names()).toContain("Record sync timeline");
	});

	// The disclosure is the consent. If the description stops saying the
	// recording contains note content, the toggle is asking for something
	// different from what it does.
	test("the toggle's description says it captures note content", () => {
		render({ diagnosticsEnabled: true });
		const desc = __settingCapture.descs.join("|");
		expect(desc.toLowerCase()).toContain("note content");
	});
});

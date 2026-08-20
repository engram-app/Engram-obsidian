/**
 * The Connection tab's "Finish sync setup" row is DERIVED from the sync gate
 * (`syncEngine.isSyncBlocked()`) and drawn once, by renderConnectionTab.
 *
 * Nothing re-rendered the pane when the gate opened. So a user sitting on the
 * settings page who clicked "Choose sync direction", accepted the preview, and
 * watched the sync start was still looking at a row telling them nothing in
 * this vault would sync — until they navigated away and back.
 *
 * The plugin already broadcasts gate changes: markSyncGateAccepted and
 * applySyncGate both end in updateStatusBar, which fires onStatusBarChange.
 * The pane just handled that signal too narrowly, re-drawing only the status
 * strip. It now also watches for a gate EDGE, which is the part that has to
 * stay edge-triggered: the same signal fires on every sync tick, and a full
 * rerender per tick would throw away scroll position and focus.
 *
 * Object.create(prototype) pattern (see settings-progress-chain.test.ts) so
 * the real handler runs against a bare fake plugin, no Obsidian DOM.
 */
import { describe, expect, test } from "bun:test";
import { EngramSyncSettingTab } from "../src/settings";

const makeTab = (startBlocked: boolean) => {
	const tab = Object.create(EngramSyncSettingTab.prototype) as any;
	const gate = { blocked: startBlocked };
	const calls = { status: 0, rerender: 0 };
	tab.plugin = { syncEngine: { isSyncBlocked: () => gate.blocked } };
	tab.renderStatus = () => {
		calls.status += 1;
	};
	tab.rerender = () => {
		calls.rerender += 1;
	};
	// What renderContent() seeds when it installs the handler.
	tab.lastSyncBlocked = startBlocked;
	const tick = () => tab.handleStatusBarChange();
	return { calls, gate, tick };
};

describe("settings pane — sync gate edge", () => {
	test("opening the gate re-renders the pane so the finish-setup row goes away", () => {
		const { calls, gate, tick } = makeTab(true);

		gate.blocked = false;
		tick();

		expect(calls.rerender).toBe(1);
	});

	// The row has to come BACK on sign-out / vault switch, which close the gate
	// again. An edge watcher that only looked for "opened" would leave a
	// blocked vault with no way to find out why nothing syncs.
	test("closing the gate re-renders too", () => {
		const { calls, gate, tick } = makeTab(false);

		gate.blocked = true;
		tick();

		expect(calls.rerender).toBe(1);
	});

	// The load-bearing half. onStatusBarChange fires on every sync tick; a
	// rerender on each one would empty and rebuild the whole pane under the
	// user's cursor.
	test("a tick with the gate unchanged only re-draws the status strip", () => {
		const { calls, tick } = makeTab(true);

		tick();
		tick();
		tick();

		expect(calls.status).toBe(3);
		expect(calls.rerender).toBe(0);
	});

	test("the edge fires once, not on every tick after it", () => {
		const { calls, gate, tick } = makeTab(true);

		gate.blocked = false;
		tick();
		tick();
		tick();

		expect(calls.rerender).toBe(1);
		expect(calls.status).toBe(3);
	});
});

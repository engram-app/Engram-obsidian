/**
 * limit-toast.ts — central handler for backend 402 LimitExceededError.
 *
 * Renders an Obsidian Notice with the reason-mapped copy from `limit-copy.ts`,
 * and (when the backend supplied an `upgradeUrl`) appends an "Upgrade" button
 * that opens the billing page in the user's external browser.
 *
 * Spec §4.6: every 402 in the plugin routes through here, so we have ONE
 * place to evolve the toast (batching, deduping, Sync Center marker, etc.)
 * rather than scattering `status === 402` checks throughout main.ts.
 */
import { Notice } from "obsidian";
import { toastFor } from "./limit-copy";
import type { LimitExceededError } from "./limit-error";

const TOAST_DURATION_MS = 10_000;

export function notifyLimitExceeded(err: LimitExceededError): void {
	const msg = toastFor(err.reason);
	const notice = new Notice(msg, TOAST_DURATION_MS);

	if (err.upgradeUrl) {
		const url = err.upgradeUrl;
		// Append a compact Upgrade button to the existing notice element.
		// Obsidian's Electron host treats window.open as an external browser
		// open by default (see src/device-flow-modal.ts:125 for the same pattern).
		const noticeEl = (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
		if (!noticeEl) return;
		const btn = noticeEl.createEl("button", {
			text: "Upgrade",
			cls: "engram-limit-upgrade-btn",
		});
		btn.addEventListener("click", () => {
			window.open(url, "_blank");
		});
	}
}

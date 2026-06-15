import { Modal } from "obsidian";
import { DEFAULT_UPGRADE_URL } from "./sync-center-render";
import type { SyncProgress } from "./types";

/** Final tally rendered when a sync settles. Plan-gated attachments land in
 *  `skipped` (informational, not a failure); genuine errors land in `failed`.
 *  The two are disjoint — the sync engine tallies plan-skips into
 *  `attachmentLimitedThisBatch` and real failures into the `failed` counter,
 *  so a single attachment is never counted in both. */
export interface CompletionSummary {
	synced: number;
	skipped: number;
	failed: number;
}

/** Render the three-way ✓ synced · ⤳ skipped (plan) · ✕ failed completion
 *  tally into `parent`, plus (when anything was plan-skipped) a one-line note
 *  pointing at the Sync Center with an [Upgrade] affordance.
 *
 *  Pure + DOM-agnostic (only uses the Obsidian element-creation helpers) so it
 *  is unit-testable without a real Modal. The caller owns clearing `parent`
 *  before re-rendering. */
export function renderCompletionSummary(parent: HTMLElement, summary: CompletionSummary): void {
	const line = parent.createDiv({ cls: "engram-progress-summary-tally" });

	// Match the modal's existing zero-handling: only show a segment when > 0.
	if (summary.synced > 0) {
		line.createSpan({
			cls: "engram-progress-tally-synced",
			text: `✓ ${summary.synced} synced`,
		});
	}
	if (summary.skipped > 0) {
		line.createSpan({
			cls: "engram-progress-tally-skipped",
			text: `⤳ ${summary.skipped} skipped (Free plan)`,
		});
	}
	if (summary.failed > 0) {
		line.createSpan({
			cls: "engram-progress-tally-failed",
			text: `✕ ${summary.failed} failed`,
		});
	}

	if (summary.skipped > 0) {
		const note = parent.createDiv({ cls: "engram-progress-plan-note" });
		const noun = summary.skipped === 1 ? "attachment" : "attachments";
		note.createSpan({
			text: `${summary.skipped} ${noun} need a paid plan — see Sync Center. `,
		});
		const upgrade = note.createEl("button", {
			text: "Upgrade",
			cls: "engram-progress-upgrade mod-cta",
		});
		upgrade.addEventListener("click", () => window.open(DEFAULT_UPGRADE_URL, "_blank"));
	}
}

const PHASE_LABELS: Record<SyncProgress["phase"], string> = {
	deleting: "Deleting local files",
	pushing: "Pushing notes",
	pulling: "Pulling notes",
	attachments: "Syncing attachments",
	complete: "Complete",
};

/** Minimum ms to display each phase before transitioning to the next. */
const MIN_PHASE_MS = 800;

/** How often to update the count/bar within a phase (ms). */
const TICK_INTERVAL_MS = 50;

/** Modal that stays open during sync, showing live progress with phase transitions.
 *  Updates are buffered so each phase is visible for at least MIN_PHASE_MS,
 *  even if the underlying operation completes faster. */
export class SyncProgressModal extends Modal {
	private phaseEl!: HTMLElement;
	private countEl!: HTMLElement;
	private pathEl!: HTMLElement;
	private barInner!: HTMLElement;
	private failedEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private hintEl!: HTMLElement;
	private bgBtn!: HTMLButtonElement;
	private closeBtn!: HTMLButtonElement;

	/** Latest progress update received from the sync engine (may be ahead of display). */
	private latest: SyncProgress | null = null;
	/** Currently displayed phase. */
	private displayedPhase: SyncProgress["phase"] | null = null;
	/** Timestamp when the current phase started displaying. */
	private phaseStartTime = 0;
	/** Interval for ticking the display forward. */
	private tickTimer: number | null = null;
	/** Queue of phase-changing updates waiting for min display time. */
	private pendingPhaseChange: SyncProgress | null = null;

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("engram-sync-progress-modal");

		contentEl.createEl("h2", { text: "Syncing..." });

		this.phaseEl = contentEl.createEl("p", {
			text: "Preparing...",
			cls: "engram-progress-phase",
		});

		this.countEl = contentEl.createEl("p", { text: "", cls: "engram-progress-count" });
		this.pathEl = contentEl.createEl("p", { text: "", cls: "engram-progress-path" });

		const barOuter = contentEl.createDiv({ cls: "engram-progress-bar-outer" });
		this.barInner = barOuter.createDiv({ cls: "engram-progress-bar-inner" });

		this.failedEl = contentEl.createEl("p", {
			text: "",
			cls: "engram-progress-failed",
		});
		this.failedEl.hidden = true;

		this.summaryEl = contentEl.createDiv({
			cls: "engram-progress-summary",
		});
		this.summaryEl.hidden = true;

		this.hintEl = contentEl.createEl("p", {
			text: "You can close this — the sync keeps running in the background.",
			cls: "engram-progress-hint",
		});

		const buttons = contentEl.createDiv({ cls: "engram-progress-buttons" });
		this.bgBtn = buttons.createEl("button", { text: "Run in background" });
		this.bgBtn.addEventListener("click", () => this.close());

		this.closeBtn = buttons.createEl("button", {
			text: "Done",
			cls: "mod-cta",
		});
		this.closeBtn.hidden = true;
		this.closeBtn.addEventListener("click", () => this.close());

		// Start the display tick loop
		this.tickTimer = window.setInterval(() => this.tick(), TICK_INTERVAL_MS);
	}

	/** Called by the sync engine's progress callback. Buffers the update. */
	update(progress: SyncProgress): void {
		this.latest = progress;
	}

	/** Periodic tick: apply buffered updates with minimum phase display time. */
	private tick(): void {
		if (!this.latest || !this.phaseEl) return;

		const now = Date.now();

		// If a phase change is pending, check if enough time has passed
		if (this.pendingPhaseChange) {
			const elapsed = now - this.phaseStartTime;
			if (elapsed < MIN_PHASE_MS) {
				// Still showing the old phase — update its final count (show 100%)
				this.renderProgress({
					...this.pendingPhaseChange,
					phase: this.displayedPhase ?? this.pendingPhaseChange.phase,
				});
				return;
			}
			// Enough time passed — apply the phase change
			this.displayedPhase = this.pendingPhaseChange.phase;
			this.phaseStartTime = now;
			this.pendingPhaseChange = null;
		}

		// Check if the latest update is a new phase
		if (this.displayedPhase !== null && this.latest.phase !== this.displayedPhase) {
			const elapsed = now - this.phaseStartTime;
			if (elapsed < MIN_PHASE_MS) {
				// Queue the phase change — keep showing current phase at 100%
				this.pendingPhaseChange = { ...this.latest };
				this.renderProgress({
					phase: this.displayedPhase,
					current: this.latest.total || 1,
					total: this.latest.total || 1,
					failed: this.latest.failed,
				});
				return;
			}
		}

		// Apply the update directly
		if (this.displayedPhase !== this.latest.phase) {
			this.displayedPhase = this.latest.phase;
			this.phaseStartTime = now;
			this.barInner.setCssStyles({ width: "0%" });
		}
		this.renderProgress(this.latest);
	}

	/** Render a progress state to the DOM. */
	private renderProgress(progress: SyncProgress): void {
		const label = PHASE_LABELS[progress.phase] ?? progress.phase;
		const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

		if (progress.phase === "complete") {
			if (this.tickTimer) {
				window.clearInterval(this.tickTimer);
				this.tickTimer = null;
			}
			this.phaseEl.setText("Sync complete");
			this.countEl.setText("");
			this.pathEl.setText("");
			this.barInner.setCssStyles({ width: "100%" });
			this.barInner.addClass("is-complete");
			this.hintEl.hidden = true;
			this.bgBtn.hidden = true;
			this.closeBtn.hidden = false;

			this.summaryEl.empty();
			renderCompletionSummary(this.summaryEl, {
				synced: progress.current,
				skipped: progress.skipped ?? 0,
				failed: progress.failed,
			});
			this.summaryEl.hidden = false;

			if (progress.failed > 0) {
				this.failedEl.setText(
					`${progress.failed} failed — run "Engram: Show sync log" for details`,
				);
				this.failedEl.hidden = false;
			} else {
				this.failedEl.hidden = true;
			}
			return;
		}

		this.phaseEl.setText(label);
		this.countEl.setText(`${progress.current} / ${progress.total}`);
		this.pathEl.setText(progress.currentPath ?? "");
		this.barInner.style.width = `${pct}%`;
		this.barInner.removeClass("is-complete");

		if (progress.failed > 0) {
			this.failedEl.setText(`${progress.failed} failed so far`);
			this.failedEl.hidden = false;
		} else {
			this.failedEl.hidden = true;
		}
	}

	onClose(): void {
		if (this.tickTimer) {
			window.clearInterval(this.tickTimer);
			this.tickTimer = null;
		}
		this.contentEl.empty();
	}
}

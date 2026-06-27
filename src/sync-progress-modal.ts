import { type App, Modal } from "obsidian";
import { DEFAULT_UPGRADE_URL } from "./sync-center-render";
import { optionBreakdown } from "./sync-plan-format";
import type { SyncChoice, SyncPlan, SyncProgress } from "./types";

/** Plain-language intro shown the instant the progress modal opens, before the
 *  first engine event arrives — the previous "Preparing..." dead state is what
 *  made the modal feel stuck. Built from the chosen plan so the user sees
 *  exactly what is about to happen. Pure for testing. */
export function describePlannedWork(
	choice: SyncChoice,
	plan: SyncPlan,
	firstSync: boolean,
): string {
	const b = optionBreakdown(plan, choice);
	const parts: string[] = [];
	if (b.pushCount > 0) parts.push(`uploading ${b.pushCount}`);
	if (b.pullCount > 0) parts.push(`downloading ${b.pullCount}`);
	if (b.deleteLocalCount > 0) {
		parts.push(
			`deleting ${b.deleteLocalCount} local ${b.deleteLocalCount === 1 ? "file" : "files"}`,
		);
	}
	if (b.deleteRemoteCount > 0) {
		parts.push(`deleting ${b.deleteRemoteCount} on the cloud`);
	}

	const prefix = firstSync ? "First sync, this may take a moment. " : "";
	if (parts.length === 0) return `${prefix}Checking for changes.`;

	const sentence = parts.join(", ");
	const capitalized = sentence.charAt(0).toUpperCase() + sentence.slice(1);
	const noDeletes = b.deleteLocalCount === 0 && b.deleteRemoteCount === 0;
	return `${prefix}${capitalized}.${noDeletes ? " Nothing will be deleted." : ""}`;
}

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

/** Plain-language recap shown when the sync settles and kept on screen until
 *  the user dismisses, so a fast sync never blanks out before they can read
 *  what happened. Complements the icon tally; failures take priority and point
 *  at the sync log. Pure for testing. */
export function describeCompletion(summary: CompletionSummary): string {
	if (summary.failed > 0) {
		return "Finished with some errors. Open the sync log to see what failed.";
	}
	if (summary.skipped > 0) {
		return "Synced. Some attachments need a paid plan to sync (see below).";
	}
	if (summary.synced > 0) {
		return "All synced. Your vault and the cloud now match.";
	}
	return "Already up to date. Nothing needed syncing.";
}

const PHASE_LABELS: Record<SyncProgress["phase"], string> = {
	deleting: "Deleting local files",
	pushing: "Uploading notes",
	pulling: "Downloading notes",
	attachments: "Syncing attachments",
	complete: "Complete",
};

/** One plain-language line under each phase label so the user knows exactly
 *  what the current step does. */
const PHASE_SUBTEXT: Record<SyncProgress["phase"], string> = {
	deleting: "Removing the files you chose to delete.",
	pushing: "Sending your notes to the cloud.",
	pulling: "Saving cloud notes into this vault.",
	attachments: "Syncing images and other attached files.",
	complete: "",
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
	private subEl!: HTMLElement;
	private countEl!: HTMLElement;
	private pathEl!: HTMLElement;
	private barInner!: HTMLElement;
	private failedEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private hintEl!: HTMLElement;
	private bgBtn!: HTMLButtonElement;
	private closeBtn!: HTMLButtonElement;

	/** Optional plan-derived intro (see describePlannedWork) shown up front so the
	 *  user knows what the sync will do before the first engine event lands. */
	constructor(
		app: App,
		private readonly opts: { intro?: string } = {},
	) {
		super(app);
	}

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

		contentEl.createEl("h2", { text: "Syncing your vault" });

		// Plan-derived summary of what is about to happen (when the caller passed
		// one). Stays visible through the whole sync as a reminder of the goal.
		if (this.opts.intro) {
			contentEl.createEl("p", {
				text: this.opts.intro,
				cls: "engram-progress-intro",
			});
		}

		this.phaseEl = contentEl.createEl("p", {
			text: "Getting started…",
			cls: "engram-progress-phase",
		});

		this.subEl = contentEl.createEl("p", {
			text: "Comparing your vault with the cloud…",
			cls: "engram-progress-subtext",
		});

		this.countEl = contentEl.createEl("p", { text: "", cls: "engram-progress-count" });
		this.pathEl = contentEl.createEl("p", { text: "", cls: "engram-progress-path" });

		const barOuter = contentEl.createDiv({ cls: "engram-progress-bar-outer" });
		this.barInner = barOuter.createDiv({ cls: "engram-progress-bar-inner" });
		// Indeterminate until the first real progress update lands, so the bar
		// animates instead of sitting frozen at 0% during setup.
		this.barInner.addClass("is-indeterminate");

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
			const summary: CompletionSummary = {
				synced: progress.current,
				skipped: progress.skipped ?? 0,
				failed: progress.failed,
			};

			this.phaseEl.setText("Sync complete");
			// Keep a readable recap on the subtext line instead of blanking it —
			// a fast sync would otherwise clear before the user can read anything.
			this.subEl.setText(describeCompletion(summary));
			this.countEl.setText("");
			this.pathEl.setText("");
			this.barInner.removeClass("is-indeterminate");
			this.barInner.setCssStyles({ width: "100%" });
			this.barInner.addClass("is-complete");
			this.hintEl.hidden = true;
			this.bgBtn.hidden = true;
			this.closeBtn.hidden = false;

			this.summaryEl.empty();
			renderCompletionSummary(this.summaryEl, summary);
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
		this.subEl.setText(PHASE_SUBTEXT[progress.phase] ?? "");
		this.countEl.setText(`${progress.current} / ${progress.total}`);
		this.pathEl.setText(progress.currentPath ?? "");
		this.barInner.removeClass("is-indeterminate");
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

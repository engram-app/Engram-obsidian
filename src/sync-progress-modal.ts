import { type App, Modal } from "obsidian";
import { optionBreakdown, pluralWord } from "./sync-plan-format";
import { DEFAULT_UPGRADE_URL } from "./tabs/urls";
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
			`deleting ${b.deleteLocalCount} local ${pluralWord(b.deleteLocalCount, "file")}`,
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
export function renderCompletionSummary(
	parent: HTMLElement,
	summary: CompletionSummary,
	webUrl?: string,
): void {
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
		const noun = pluralWord(summary.skipped, "attachment");
		note.createSpan({
			text: `${summary.skipped} ${noun} need a paid plan to sync. See Sync Center. `,
		});
		const upgrade = note.createEl("button", {
			text: "Upgrade",
			cls: "engram-progress-upgrade mod-cta",
		});
		// Prefer the backend's own web app (threaded in as webUrl) so a
		// self-hosted user is not sent to cloud billing.
		const upgradeUrl = webUrl ? `${webUrl}/settings/billing` : DEFAULT_UPGRADE_URL;
		upgrade.addEventListener("click", () => window.open(upgradeUrl, "_blank"));
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

/** A phase that this sync will actually perform, in display order. Used to seed
 *  one persistent progress row per phase so the whole plan is visible up front
 *  and each row stays on screen (with its final count) after it finishes. */
export interface PlannedPhase {
	phase: "deleting" | "pushing" | "pulling";
	label: string;
	total: number;
}

/** The phases a given choice will run, in display order, with their planned
 *  totals from the plan. The engine only emits deleting / pushing / pulling
 *  (attachments are counted within push and pull, never a separate phase), so
 *  these are the only rows that can receive progress. Pure for testing. */
export function plannedPhases(choice: SyncChoice, plan: SyncPlan): PlannedPhase[] {
	const b = optionBreakdown(plan, choice);
	const deleting = b.deleteLocalCount + b.deleteRemoteCount;
	const out: PlannedPhase[] = [];
	if (deleting > 0) out.push({ phase: "deleting", label: "Deleting", total: deleting });
	if (b.pullCount > 0) out.push({ phase: "pulling", label: "Downloading", total: b.pullCount });
	if (b.pushCount > 0) out.push({ phase: "pushing", label: "Uploading", total: b.pushCount });
	return out;
}

/** How often to flush buffered progress to the DOM (ms). */
const TICK_INTERVAL_MS = 50;

/** Resolve the {current, total} a progress row should display.
 *
 *  `planned` (row was seeded from the plan): keep `plannedTotal` as the
 *  denominator. The engine's live `total` counts every file it *examines* —
 *  hash-unchanged and CRDT-owned files are counted there and then skipped, so
 *  when `syncState` is stale that number can be many times the plan's
 *  manifest-diff count and would make the denominator balloon mid-sync (the
 *  "Uploading 5" → "Uploading 50" jump). The plan number is the honest "files
 *  that will actually sync" count, so it wins.
 *
 *  `!planned` (a phase the plan didn't predict): trust the engine's total,
 *  falling back to the row's previous total when the engine reports 0.
 *
 *  `current` (the engine now reports *actual uploads*, not files processed) can
 *  never overshoot the denominator: on a planned row the plan is only a *floor*
 *  — if actual uploads exceed the prediction (files created mid-sync) the total
 *  grows to the real count so the row agrees with the completion recap, rather
 *  than pinning at the plan and disagreeing. Actual uploads are honest and can't
 *  balloon like the engine's examine-count, so raising the floor is safe.
 *
 *  `total === 0` is indeterminate (a plan-less phase whose engine total is
 *  unknown, e.g. an incremental cursor pull): `current` is left un-clamped so
 *  callers can still show the running count as activity — clamping it to a 0
 *  total would freeze the display at "0". Pure for testing. */
export function rowCounts(
	planned: boolean,
	plannedTotal: number,
	engineCurrent: number,
	engineTotal: number,
	prevTotal: number,
): { current: number; total: number } {
	const total = planned ? Math.max(plannedTotal, engineCurrent) : engineTotal || prevTotal;
	return { current: total > 0 ? Math.min(engineCurrent, total) : engineCurrent, total };
}

/** Resolve what the settings-pane progress bar should show for one engine
 *  event, so that secondary bar matches the plan-aware modal instead of
 *  rendering the raw `current/total` (which mixes units — `current` is actual
 *  work, `total` is files-examined — and could sit stuck-low, pin at 100%, or
 *  overshoot past 100%).
 *
 *  - `planned` set (a manual sync stashed its plan): route through `rowCounts`
 *    so the bar uses the honest manifest-diff denominator and clamps, exactly
 *    like the modal row.
 *  - engine total known (>0), no plan: clamp `current` to it (kills the
 *    "25 / 20" overshoot).
 *  - no honest denominator (0 — e.g. an incremental cursor pull whose total is
 *    unknown until the stream ends): indeterminate. Show the running count as
 *    activity with an empty bar, never a fabricated 100%.
 *
 *  Pure for testing. */
export function settingsBarCounts(
	progress: Pick<SyncProgress, "current" | "total">,
	planned: PlannedPhase | undefined,
	prevTotal: number,
): { current: number; total: number; pct: number } {
	const { current, total } = rowCounts(
		Boolean(planned),
		planned?.total ?? 0,
		progress.current,
		progress.total,
		prevTotal,
	);
	return {
		current,
		total,
		pct: total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0,
	};
}

interface RowState {
	phase: SyncProgress["phase"];
	label: string;
	plannedTotal: number;
	/** True when this row was seeded from the plan (so its denominator is the
	 *  honest manifest-diff count, not the engine's larger examine-count). */
	planned: boolean;
	current: number;
	total: number;
	failed: number;
	/** True once this phase has reported at least one event. */
	seen: boolean;
	done: boolean;
}

interface RowEls {
	statusEl: HTMLElement;
	barInner: HTMLElement;
	countEl: HTMLElement;
}

/** Modal that stays open during sync. Shows one persistent row per phase the
 *  sync will perform, seeded from the plan: every phase is visible up front,
 *  fills as it runs, and stays on screen with its final count when done — so a
 *  fast sync no longer flashes its detail away. */
export class SyncProgressModal extends Modal {
	private rowsWrap!: HTMLElement;
	private statusEl!: HTMLElement;
	private pathEl!: HTMLElement;
	private recapEl!: HTMLElement;
	private failedEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private verifyEl!: HTMLElement;
	private hintEl!: HTMLElement;
	private actionBtn!: HTMLButtonElement;

	private rows: RowState[] = [];
	private readonly rowEls = new Map<SyncProgress["phase"], RowEls>();
	/** Latest progress update from the engine, applied on the next tick. */
	private latest: SyncProgress | null = null;
	private tickTimer: number | null = null;

	/** `intro`: plan-derived summary (see describePlannedWork). `phases`: the
	 *  rows to seed (see plannedPhases). `webUrl`: the Engram web app to link to
	 *  on completion so the user can verify their vault. All optional so callers
	 *  without a plan still get a usable modal. */
	constructor(
		app: App,
		private readonly opts: { intro?: string; phases?: PlannedPhase[]; webUrl?: string } = {},
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("engram-sync-progress-modal");
		contentEl.addClass("engram-flow-modal");

		contentEl.createEl("h2", { text: "Syncing your vault" });

		if (this.opts.intro) {
			contentEl.createEl("p", { text: this.opts.intro, cls: "engram-progress-intro" });
		}

		this.statusEl = contentEl.createEl("p", {
			text: "Getting started…",
			cls: "engram-progress-status",
		});

		this.rowsWrap = contentEl.createDiv({ cls: "engram-progress-rows" });
		this.rows = (this.opts.phases ?? []).map((p) => ({
			phase: p.phase,
			label: p.label,
			plannedTotal: p.total,
			planned: true,
			current: 0,
			total: p.total,
			failed: 0,
			seen: false,
			done: false,
		}));
		for (const row of this.rows) this.createRow(row);

		this.pathEl = contentEl.createEl("p", { text: "", cls: "engram-progress-path" });

		this.recapEl = contentEl.createEl("p", { text: "", cls: "engram-progress-subtext" });
		this.recapEl.hidden = true;

		this.failedEl = contentEl.createEl("p", { text: "", cls: "engram-progress-failed" });
		this.failedEl.hidden = true;

		this.summaryEl = contentEl.createDiv({ cls: "engram-progress-summary" });
		this.summaryEl.hidden = true;

		// Post-sync nudge to open Engram and confirm the vault looks right.
		// Shown on completion only; needs a web URL to link to.
		this.verifyEl = contentEl.createEl("p", { cls: "engram-progress-verify" });
		this.verifyEl.hidden = true;
		if (this.opts.webUrl) {
			const url = this.opts.webUrl;
			this.verifyEl.createSpan({
				text: "Open Engram to check your vault and confirm everything synced. ",
			});
			const link = this.verifyEl.createEl("a", {
				text: "Open Engram",
				cls: "engram-progress-verify-link",
				href: url,
			});
			link.setAttr("target", "_blank");
			link.setAttr("rel", "noopener");
			// Obsidian's Electron host opens window.open in the system browser;
			// drive it explicitly so the link works regardless of <a> handling.
			link.addEventListener("click", (e) => {
				e.preventDefault();
				window.open(url, "_blank");
			});
		}

		this.hintEl = contentEl.createEl("p", {
			text: "You can close this and the sync keeps running in the background.",
			cls: "engram-progress-hint",
		});

		// ONE button: closing is the only action this modal has (the sync keeps
		// running either way), so two buttons was two labels for one behavior —
		// and Obsidian's theme styles button display, which defeats the [hidden]
		// attribute the old show-one-hide-other swap relied on (both rendered).
		const buttons = contentEl.createDiv({ cls: "engram-progress-buttons" });
		this.actionBtn = buttons.createEl("button", { text: "Run in background" });
		this.actionBtn.addEventListener("click", () => this.close());

		this.renderRows();
		this.tickTimer = window.setInterval(() => this.tick(), TICK_INTERVAL_MS);
	}

	/** Called by the sync engine's progress callback. Buffers the update. */
	update(progress: SyncProgress): void {
		this.latest = progress;
	}

	private tick(): void {
		if (!this.latest) return;
		const progress = this.latest;
		this.latest = null;
		this.applyProgress(progress);
	}

	private createRow(row: RowState): void {
		const rowEl = this.rowsWrap.createDiv({ cls: "engram-progress-row" });
		const statusEl = rowEl.createSpan({ cls: "engram-progress-row-status", text: "·" });
		rowEl.createSpan({ cls: "engram-progress-row-label", text: row.label });
		const barOuter = rowEl.createDiv({ cls: "engram-progress-bar-outer" });
		const barInner = barOuter.createDiv({ cls: "engram-progress-bar-inner" });
		const countEl = rowEl.createSpan({
			cls: "engram-progress-row-count",
			text: `0 / ${row.plannedTotal}`,
		});
		this.rowEls.set(row.phase, { statusEl, barInner, countEl });
	}

	private applyProgress(progress: SyncProgress): void {
		if (progress.phase === "complete") {
			this.applyComplete(progress);
			return;
		}

		let row = this.rows.find((r) => r.phase === progress.phase);
		if (!row) {
			// Engine reported a phase the plan didn't predict — add a row so its
			// progress is still visible rather than silently dropped.
			row = {
				phase: progress.phase,
				label: PHASE_FALLBACK_LABEL[progress.phase] ?? progress.phase,
				plannedTotal: progress.total,
				planned: false,
				current: 0,
				total: progress.total,
				failed: 0,
				seen: false,
				done: false,
			};
			this.rows.push(row);
			this.createRow(row);
		}

		row.seen = true;
		const counts = rowCounts(
			row.planned,
			row.plannedTotal,
			progress.current,
			progress.total,
			row.total,
		);
		row.current = counts.current;
		row.total = counts.total;
		row.failed = progress.failed;

		// Any other phase that has already run is now finished.
		for (const other of this.rows) {
			if (other !== row && other.seen) other.done = true;
		}

		this.statusEl.setText("Syncing…");
		this.pathEl.setText(progress.currentPath ?? "");
		this.renderRows();
	}

	private applyComplete(progress: SyncProgress): void {
		if (this.tickTimer) {
			window.clearInterval(this.tickTimer);
			this.tickTimer = null;
		}

		for (const row of this.rows) {
			row.done = true;
			row.current = row.total;
		}
		this.renderRows();

		const summary: CompletionSummary = {
			synced: progress.current,
			skipped: progress.skipped ?? 0,
			failed: progress.failed,
		};

		this.statusEl.setText("Sync complete");
		this.pathEl.setText("");
		this.recapEl.setText(describeCompletion(summary));
		this.recapEl.hidden = false;

		this.summaryEl.empty();
		renderCompletionSummary(this.summaryEl, summary, this.opts.webUrl);
		this.summaryEl.hidden = false;

		if (summary.failed > 0) {
			this.failedEl.setText(
				`${summary.failed} failed. Run "Engram: Show sync log" for details.`,
			);
			this.failedEl.hidden = false;
		} else {
			this.failedEl.hidden = true;
		}

		// Nudge the user to verify their vault on Engram (only if we have a URL).
		this.verifyEl.hidden = !this.opts.webUrl;

		this.hintEl.hidden = true;
		this.actionBtn.setText("Done");
		this.actionBtn.addClass("mod-cta");
	}

	private renderRows(): void {
		for (const row of this.rows) {
			const els = this.rowEls.get(row.phase);
			if (!els) continue;
			const pct =
				row.total > 0 ? Math.round((row.current / row.total) * 100) : row.done ? 100 : 0;
			els.barInner.style.width = `${pct}%`;
			els.barInner.toggleClass("is-complete", row.done);
			// total 0 = indeterminate (unknown-length pull): show the running count
			// as activity rather than a frozen "0 / 0" or a misleading "3 / 0".
			els.countEl.setText(row.total > 0 ? `${row.current} / ${row.total}` : `${row.current}`);
			els.statusEl.setText(row.done ? "✓" : row.seen ? "⟳" : "·");
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

/** The per-phase display copy. Primary label source for the settings-pane
 *  progress bar (every phase), and the modal's fallback for a phase the plan
 *  did not predict — the two surfaces deliberately share one map so they can
 *  never disagree on wording again. */
export const PHASE_FALLBACK_LABEL: Record<SyncProgress["phase"], string> = {
	deleting: "Deleting",
	pushing: "Uploading",
	pulling: "Downloading",
	attachments: "Syncing attachments",
	complete: "Complete",
};

import { type App, Modal, setIcon } from "obsidian";
import { toastFor } from "./limit-copy";
import { LimitExceededError } from "./limit-error";
import { isTextAttachment } from "./mime";
import {
	type OptionBreakdown,
	buildDeletionTree,
	computeMatchPercent,
	isDestructiveChoice,
	isPlanEmpty,
	optionBreakdown,
} from "./sync-plan-format";
import type { SyncChoice, SyncPlan, SyncPreviewContext, VaultInfo } from "./types";

/** Pure state machine for the SyncPreviewModal. Owns view + input state and
 *  the resolve callback. Tested directly; the Modal class is a thin DOM
 *  wrapper that delegates to it. */
export class SyncPreviewState {
	view: "preview" | "confirm" | "vault-picker" | "done" = "preview";
	pendingChoice: SyncChoice | null = null;
	confirmInput = "";
	/** Mutable so the modal can swap in a fresh plan after applyVaultChange.
	 *  Null while the initial plan is still computing — the modal opens instantly
	 *  in a loading state and fills in once `replacePlan` runs. */
	plan: SyncPlan | null;
	/** Set when the initial plan computation fails; surfaced in the loading
	 *  view so an instant-open modal is not stuck on a blank spinner. */
	planError: string | null = null;
	vaultsLoading = false;
	vaults: VaultInfo[] | null = null;
	vaultsError: string | null = null;
	/** Within the vault-picker, true while the "make a new vault" form is shown
	 *  instead of the list of existing vaults. */
	creatingVault = false;
	/** Whether the "advanced sync options" accordion (push/pull grid) is
	 *  expanded. Collapsed by default so the modal leads with the Sync action. */
	advancedOpen = false;
	private resolved = false;

	constructor(
		initialPlan: SyncPlan | null,
		private readonly onResolve: (choice: SyncChoice) => void,
	) {
		this.plan = initialPlan;
	}

	pickOption(choice: SyncChoice): void {
		if (this.resolved) return;
		if (isDestructiveChoice(choice)) {
			this.pendingChoice = choice;
			this.view = "confirm";
			this.confirmInput = "";
			return;
		}
		this.resolve(choice);
	}

	typeConfirm(input: string): void {
		if (this.resolved || this.view !== "confirm") return;
		this.confirmInput = input;
	}

	canSubmitConfirm(): boolean {
		return this.view === "confirm" && this.confirmInput === "delete";
	}

	submitConfirm(): void {
		if (!this.canSubmitConfirm() || this.pendingChoice == null) return;
		this.resolve(this.pendingChoice);
	}

	goBack(): void {
		if (this.resolved) return;
		this.view = "preview";
		this.pendingChoice = null;
		this.confirmInput = "";
	}

	toggleAdvanced(): void {
		if (this.resolved) return;
		this.advancedOpen = !this.advancedOpen;
	}

	enterVaultPicker(): void {
		if (this.resolved) return;
		this.view = "vault-picker";
		this.vaultsLoading = true;
		this.vaults = null;
		this.vaultsError = null;
		this.creatingVault = false;
	}

	enterCreateVault(): void {
		if (this.resolved) return;
		this.creatingVault = true;
		this.vaultsError = null;
	}

	exitCreateVault(): void {
		this.creatingVault = false;
		this.vaultsError = null;
	}

	onVaultsLoaded(vaults: VaultInfo[]): void {
		this.vaultsLoading = false;
		this.vaults = vaults;
		this.vaultsError = null;
	}

	onVaultsError(message: string): void {
		this.vaultsLoading = false;
		this.vaults = null;
		this.vaultsError = message;
	}

	exitVaultPicker(): void {
		if (this.resolved) return;
		this.view = "preview";
		this.vaultsLoading = false;
		this.vaults = null;
		this.vaultsError = null;
		this.creatingVault = false;
	}

	/** Swap in the SyncPlan that came back from applyVaultChange, or the deferred
	 *  initial plan once it resolves. Clears any prior plan-load error. Caller is
	 *  responsible for re-rendering. */
	replacePlan(plan: SyncPlan): void {
		this.plan = plan;
		this.planError = null;
	}

	cancel(): void {
		this.resolve("cancel");
	}

	private resolve(choice: SyncChoice): void {
		if (this.resolved) return;
		this.resolved = true;
		this.view = "done";
		this.onResolve(choice);
	}
}

/** Map a createVault rejection to a short human label. LimitExceededError =
 *  402 from the standardized backend body (spec §4.6), 422 = validation
 *  (e.g. duplicate/empty name), else a generic connection message. Pure
 *  for testing. */
export function describeCreateVaultError(e: unknown): string {
	if (e instanceof LimitExceededError) return toastFor(e.reason);
	const status = (e as { status?: number })?.status;
	if (status === 422) return "Couldn't create vault — the name may be invalid or already in use.";
	return "Could not create the vault — check your connection and try again.";
}

/** Lowercase file extension (no leading dot) of a path, or "" when none. */
function extOf(path: string): string {
	const base = path.slice(path.lastIndexOf("/") + 1);
	const dot = base.lastIndexOf(".");
	return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** How many attachments the upcoming push would skip under a text-only plan.
 *  Mirrors the backend's Free text-only gate (see `mime.ts`): an attachment is
 *  skipped iff its effective MIME does NOT start with `text/`. Returns 0 when
 *  the plan is not text-only (nothing is gated). Pure for testing. */
export function countSkippedAttachments(plan: SyncPlan, attachmentsTextOnly: boolean): number {
	if (!attachmentsTextOnly) return 0;
	return plan.toPush.attachments.filter((p) => !isTextAttachment(extOf(p))).length;
}

/** The one muted pre-flight line for plan-skipped attachments, or null when
 *  there is nothing to say (n === 0). Pure for testing. */
export function skippedAttachmentsLine(n: number): string | null {
	if (n <= 0) return null;
	const noun = n === 1 ? "attachment" : "attachments";
	return `Free syncs notes only — ${n} ${noun} will be skipped.`;
}

/** Plain-language outcome line for the smart-merge ("Sync") option, computed
 *  from the plan. Smart-merge never deletes, so the line always reassures.
 *  First-time and vault-switch lead with a safety clause for users who do not
 *  yet trust what the button does. Pure for testing. */
export function mergeHelperText(b: OptionBreakdown, context: SyncPreviewContext): string {
	const counts: string[] = [];
	if (b.pushCount > 0) counts.push(`Uploads ${b.pushCount}`);
	if (b.pullCount > 0) counts.push(`downloads ${b.pullCount}`);
	let countLine = counts.join(", ");
	if (countLine) countLine = `${countLine.charAt(0).toUpperCase()}${countLine.slice(1)}.`;
	const conflict = b.conflictCount > 0 ? ` ${b.conflictCount} conflicts to resolve.` : "";

	if (context === "first-time" || context === "vault-switch") {
		const lead = "Safe choice: combines both sides, nothing is deleted.";
		const tail = countLine ? ` ${countLine}${conflict}`.trimEnd() : "";
		return `${lead}${tail}`;
	}
	return countLine
		? `${countLine}${conflict} Nothing is deleted.`
		: "Already in sync. Nothing is deleted.";
}

interface OptionCard {
	choice: SyncChoice;
	emoji: string;
	label: string;
	subtitle: (b: OptionBreakdown, context: SyncPreviewContext) => string;
	cssClass: string;
}

const MERGE_CARD: OptionCard = {
	choice: "smart-merge",
	emoji: "✨",
	label: "Sync",
	// The Sync description is rendered once above the button (see renderPreview),
	// so the card itself carries no subtitle.
	subtitle: () => "",
	cssClass: "engram-sync-preview-option mod-cta",
};

const PUSH_CARDS: OptionCard[] = [
	{
		choice: "push-all-keep-remote",
		emoji: "⬆️",
		label: "Upload local, keep cloud files",
		subtitle: (b) => `Upload ${b.pushCount}, keep cloud extras`,
		cssClass: "engram-sync-preview-option",
	},
	{
		choice: "push-all-delete-remote",
		emoji: "🗑️",
		label: "Delete all on remote, then upload local files",
		subtitle: (b) => `Delete ${b.deleteRemoteCount} on cloud, upload ${b.pushCount}`,
		cssClass: "engram-sync-preview-option engram-sync-preview-destructive",
	},
];

const PULL_CARDS: OptionCard[] = [
	{
		choice: "pull-all-keep-local",
		emoji: "⬇️",
		label: "Download cloud, keep local files",
		subtitle: (b) => `Download ${b.pullCount}, keep local extras`,
		cssClass: "engram-sync-preview-option",
	},
	{
		choice: "pull-all-delete-local",
		emoji: "🗑️",
		label: "Delete all local files, then download from remote",
		subtitle: (b) => `Delete ${b.deleteLocalCount} local, download ${b.pullCount}`,
		cssClass: "engram-sync-preview-option engram-sync-preview-destructive",
	},
];

export const HEADER_BY_CONTEXT: Record<SyncPreviewContext, string> = {
	"first-time": "Set up sync for this vault",
	"vault-switch": "You are now pointing at a different cloud vault",
	review: "Sync preview",
};

export interface SyncPreviewOptions {
	/** Server-side vault name. Falls back to "Cloud Server" when missing. */
	remoteVaultName?: string;
	/** When true the footer shows a "Change vault" button. Off for triggers
	 *  outside the vault picker (e.g. Sync Center). */
	showChangeVault: boolean;
	/** Drives header copy. Defaults to "review" when not provided. */
	context?: SyncPreviewContext;
	/** Fetches the list of vaults the user can switch to. Called when the
	 *  user presses Change Vault. Required when showChangeVault is true. */
	listVaults?: () => Promise<VaultInfo[]>;
	/** Persists a vault switch and returns the new SyncPlan so the modal can
	 *  re-render in place. Required when showChangeVault is true. */
	applyVaultChange?: (id: string, name: string) => Promise<SyncPlan>;
	/** Creates a brand-new vault and returns it. When provided, the picker shows
	 *  a "Make new vault" affordance. The created vault is then selected via
	 *  applyVaultChange so the preview recalculates against the empty remote. */
	createVault?: (name: string) => Promise<VaultInfo>;
	/** Initial view the modal opens on. Defaults to "preview". Set to
	 *  "vault-picker" when the user entered the modal via a "Change vault"
	 *  affordance on the settings page. */
	initialView?: "preview" | "vault-picker";
	/** Current plan's text-only attachment flag. When true and the upcoming
	 *  push includes non-text attachments, the preview shows one muted
	 *  informational line saying they will be skipped. Omitted/undefined =
	 *  unknown plan → no line. */
	attachmentsTextOnly?: boolean;
}

export class SyncPreviewModal extends Modal {
	private state: SyncPreviewState;
	private resolvedChoice: SyncChoice | null = null;
	private resolveFn: ((c: SyncChoice) => void) | null = null;
	/** Mirrors state.plan.vaultName + opts.remoteVaultName so the picker view
	 *  can swap in fresh values after applyVaultChange. */
	private remoteVaultName: string | undefined;

	constructor(
		app: App,
		plan: SyncPlan | null,
		private readonly opts: SyncPreviewOptions,
	) {
		super(app);
		this.remoteVaultName = opts.remoteVaultName;
		this.state = new SyncPreviewState(plan, (choice) => {
			this.resolvedChoice = choice;
			this.close();
		});
	}

	onOpen(): void {
		this.contentEl.addClass("engram-sync-preview-modal");
		if (this.opts.initialView === "vault-picker") {
			void this.openVaultPicker();
		} else {
			this.render();
		}
	}

	onClose(): void {
		// Defensive: if the user dismisses via Esc/backdrop before picking,
		// treat that as a cancel.
		const resolve = this.resolveFn;
		this.resolveFn = null;
		this.contentEl.empty();
		if (resolve) resolve(this.resolvedChoice ?? "cancel");
	}

	awaitChoice(): Promise<SyncChoice> {
		return new Promise((resolve) => {
			this.resolveFn = resolve;
			this.open();
		});
	}

	/** Fill in the deferred initial plan once the background computeSyncPlan
	 *  resolves, refreshing the loading/preview view in place. Only applies while
	 *  the plan is still null: if the user already switched vaults in the picker,
	 *  applyVaultChange's replacePlan is authoritative and a late-arriving plan
	 *  for the old vault must not clobber it. */
	setPlan(plan: SyncPlan): void {
		if (this.state.plan != null) return;
		this.state.replacePlan(plan);
		if (this.state.view === "preview") this.render();
	}

	/** Surface a plan-load failure in the instant-open loading view. Skipped once
	 *  a plan exists (e.g. the user switched vaults), so a stale failure never
	 *  overwrites a good plan. */
	setPlanError(message: string): void {
		if (this.state.plan != null) return;
		this.state.planError = message;
		if (this.state.view === "preview") this.render();
	}

	/** The plan the user ultimately chose against (after any vault switch), or
	 *  null if it never loaded. Lets the caller describe the planned work in the
	 *  progress modal. */
	getPlan(): SyncPlan | null {
		return this.state.plan;
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		if (this.state.view === "preview") {
			this.renderPreview();
		} else if (this.state.view === "vault-picker") {
			this.renderVaultPicker();
		} else {
			this.renderConfirm();
		}
	}

	private renderPreview(): void {
		const { contentEl } = this;
		const context = this.opts.context ?? "review";

		// Instant-open: the modal is already on screen while the initial plan
		// computes in the background. Show a loading state until it arrives.
		if (this.state.plan == null) {
			this.renderPlanLoading(contentEl, context);
			return;
		}

		const empty = isPlanEmpty(this.state.plan);

		this.renderHeader(contentEl, empty ? "up-to-date" : context);
		this.renderComparison(contentEl);
		this.renderSkippedAttachmentsNote(contentEl);

		const options = contentEl.createDiv({ cls: "engram-sync-preview-options" });
		// The plain-language description of what Sync will do sits above the
		// button (replacing the old generic "Choose a sync direction" prompt).
		// When already in sync there's nothing to describe — drop it but still
		// offer Sync + the (collapsed) advanced options for a deliberate
		// force push/pull or recovery.
		if (!empty) {
			options.createDiv({
				cls: "engram-sync-preview-options-header",
				text: mergeHelperText(optionBreakdown(this.requirePlan(), "smart-merge"), context),
			});
		}

		const mergeRow = options.createDiv({ cls: "engram-sync-preview-options-merge" });
		this.renderOptionCard(mergeRow, MERGE_CARD, context);

		this.renderAdvancedOptions(options, context);

		const footer = contentEl.createDiv({ cls: "engram-sync-preview-footer" });
		const dismissBtn = footer.createEl("button", {
			text: empty ? "Close" : "Cancel",
			cls: empty ? "mod-cta" : undefined,
		});
		dismissBtn.addEventListener("click", () => this.state.cancel());
		if (this.opts.showChangeVault) {
			const changeBtn = footer.createEl("button", { text: "Change vault" });
			changeBtn.addEventListener("click", () => {
				void this.openVaultPicker();
			});
		}
	}

	/** Instant-open loading state: the modal is on screen while computeSyncPlan
	 *  runs. Shows the context header plus a calm progress line (or the load
	 *  error), and keeps Cancel + Change vault reachable so the user is never
	 *  trapped on a spinner. */
	private renderPlanLoading(parent: HTMLElement, context: SyncPreviewContext): void {
		this.renderHeader(parent, context);
		const body = parent.createDiv({ cls: "engram-sync-preview-loading" });
		if (this.state.planError) {
			body.createSpan({
				cls: "engram-sync-preview-picker-error",
				text: this.state.planError,
			});
		} else {
			body.createSpan({ text: "Comparing your vault with the cloud…" });
		}

		const footer = parent.createDiv({ cls: "engram-sync-preview-footer" });
		const cancelBtn = footer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.state.cancel());
		if (this.opts.showChangeVault) {
			const changeBtn = footer.createEl("button", { text: "Change vault" });
			changeBtn.addEventListener("click", () => {
				void this.openVaultPicker();
			});
		}
	}

	/** The loaded plan. Only reached from render paths that run after the plan
	 *  has arrived (renderPreview gates on it); throws otherwise as a guard
	 *  against a future caller skipping the loading gate. */
	private requirePlan(): SyncPlan {
		const p = this.state.plan;
		if (!p) throw new Error("SyncPreviewModal: plan accessed before it loaded");
		return p;
	}

	/** Render the "Show advanced sync options" accordion (collapsed by default)
	 *  with the push/pull direction grid. Shared by the up-to-date and
	 *  has-changes preview states so force push/pull stays reachable even at
	 *  100% match. */
	private renderAdvancedOptions(options: HTMLElement, context: SyncPreviewContext): void {
		const advancedToggle = options.createEl("button", {
			cls: "engram-sync-preview-advanced-toggle",
		});
		advancedToggle.createSpan({ text: "Show advanced sync options" });
		const chevron = advancedToggle.createSpan({
			cls: "engram-sync-preview-advanced-chevron",
		});
		setIcon(chevron, this.state.advancedOpen ? "chevron-down" : "chevron-right");
		advancedToggle.addEventListener("click", () => {
			this.state.toggleAdvanced();
			this.render();
		});

		const grid = options.createDiv({ cls: "engram-sync-preview-options-grid" });
		if (!this.state.advancedOpen) grid.addClass("is-collapsed");
		const pushCol = grid.createDiv({ cls: "engram-sync-preview-options-col" });
		pushCol.createDiv({
			text: "Push (local → cloud)",
			cls: "engram-sync-preview-options-col-header",
		});
		for (const card of PUSH_CARDS) {
			this.renderOptionCard(pushCol, card, context);
		}

		const pullCol = grid.createDiv({ cls: "engram-sync-preview-options-col" });
		pullCol.createDiv({
			text: "Pull (cloud → local)",
			cls: "engram-sync-preview-options-col-header",
		});
		for (const card of PULL_CARDS) {
			this.renderOptionCard(pullCol, card, context);
		}
	}

	/** One calm, non-blocking info line for a text-only (Free) plan when the
	 *  upcoming push includes non-text attachments. Renders nothing when the
	 *  plan isn't text-only, the flag is unknown, or the count is zero. */
	private renderSkippedAttachmentsNote(parent: HTMLElement): void {
		const n = countSkippedAttachments(
			this.requirePlan(),
			this.opts.attachmentsTextOnly === true,
		);
		const text = skippedAttachmentsLine(n);
		if (text == null) return;
		const note = parent.createDiv({ cls: "engram-sync-preview-skip-note" });
		note.createSpan({ text: "ℹ️ ", cls: "engram-sync-preview-skip-note-icon" });
		note.createSpan({ text });
	}

	private renderHeader(parent: HTMLElement, context: SyncPreviewContext | "up-to-date"): void {
		if (context === "up-to-date") {
			const h = parent.createEl("h2", {
				cls: "engram-sync-preview-header engram-sync-preview-header-success",
			});
			h.createSpan({ text: "✅ ", cls: "engram-sync-preview-header-emoji" });
			h.createSpan({ text: "Everything is in sync" });
			return;
		}
		parent.createEl("h2", {
			text: HEADER_BY_CONTEXT[context],
			cls: "engram-sync-preview-header",
		});
	}

	private renderComparison(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "engram-sync-preview-compare" });
		const plan = this.requirePlan();

		this.renderCompareCard(wrap, {
			emoji: "💻",
			name: plan.vaultName,
			role: "This vault",
			notes: plan.localNoteCount,
			attachments: plan.localAttachmentCount,
			folders: plan.localFolderCount,
		});
		this.renderCompareCard(wrap, {
			emoji: "☁️",
			name: this.remoteVaultName || "Cloud server",
			role: "Cloud server",
			notes: plan.serverNoteCount,
			attachments: plan.serverAttachmentCount,
			folders: plan.serverFolderCount,
		});

		const match = computeMatchPercent(plan);
		const conflicts = plan.conflicts.length;
		const matchRow = parent.createDiv({ cls: "engram-sync-preview-match" });
		matchRow.createSpan({
			cls: "engram-sync-preview-match-label",
			text: "Your vault shares ",
		});
		const matchValue = matchRow.createSpan({
			cls: "engram-sync-preview-match-value",
			text: `${match}%`,
		});
		if (match === 100) matchValue.addClass("is-perfect");
		matchRow.createSpan({
			cls: "engram-sync-preview-match-label",
			text: " of its data with Engram",
		});
		if (conflicts > 0) {
			const conflictRow = parent.createDiv({ cls: "engram-sync-preview-conflicts" });
			conflictRow.createSpan({
				cls: "engram-sync-preview-conflicts-value",
				text: `⚡ ${conflicts}`,
			});
			conflictRow.createSpan({
				cls: "engram-sync-preview-conflicts-label",
				text: ` conflict${conflicts === 1 ? "" : "s"} need resolution`,
			});
		}
	}

	private renderCompareCard(
		parent: HTMLElement,
		card: {
			emoji: string;
			name: string;
			role: string;
			notes: number;
			attachments: number;
			folders: number;
		},
	): void {
		const col = parent.createDiv({ cls: "engram-sync-preview-compare-col" });
		const title = col.createDiv({ cls: "engram-sync-preview-compare-title" });
		title.createSpan({ text: card.emoji, cls: "engram-sync-preview-compare-emoji" });
		title.createSpan({ text: card.name, cls: "engram-sync-preview-compare-name" });
		col.createDiv({
			text: card.role,
			cls: "engram-sync-preview-compare-role",
		});
		const cardEl = col.createDiv({ cls: "engram-sync-preview-compare-card" });
		const body = cardEl.createDiv({ cls: "engram-sync-preview-compare-card-body" });
		this.renderCompareRow(body, "📄", card.notes, "notes");
		this.renderCompareRow(body, "📎", card.attachments, "attachments");
		this.renderCompareRow(body, "📁", card.folders, "folders");
	}

	private renderCompareRow(
		parent: HTMLElement,
		emoji: string,
		count: number,
		label: string,
	): void {
		const row = parent.createDiv({ cls: "engram-sync-preview-compare-row" });
		row.createSpan({ text: emoji, cls: "engram-sync-preview-compare-row-emoji" });
		row.createSpan({
			text: String(count),
			cls: "engram-sync-preview-compare-row-count",
		});
		row.createSpan({
			text: label,
			cls: "engram-sync-preview-compare-row-label",
		});
	}

	private renderOptionCard(
		parent: HTMLElement,
		card: OptionCard,
		context: SyncPreviewContext,
	): void {
		const b = optionBreakdown(this.requirePlan(), card.choice);
		const wrap = parent.createDiv({ cls: "engram-sync-preview-option-wrap" });
		const btn = wrap.createEl("button", { cls: card.cssClass });
		btn.createSpan({ text: card.emoji, cls: "engram-sync-preview-option-emoji" });
		btn.createSpan({ text: card.label, cls: "engram-sync-preview-option-label" });
		const subtitle = card.subtitle(b, context);
		if (subtitle) {
			wrap.createEl("p", {
				text: subtitle,
				cls: "engram-sync-preview-option-subtitle",
			});
		}
		btn.addEventListener("click", () => {
			this.state.pickOption(card.choice);
			this.render();
		});
	}

	private renderConfirm(): void {
		const { contentEl } = this;
		const choice = this.state.pendingChoice;
		if (choice == null) return;

		contentEl.createEl("h2", {
			text: "Confirm destructive sync",
			cls: "engram-sync-preview-header",
		});

		const b = optionBreakdown(this.requirePlan(), choice);
		const summary = contentEl.createDiv({ cls: "engram-sync-preview-confirm-summary" });
		summary.createEl("p", { text: "You are about to:" });
		const ul = summary.createEl("ul");
		if (b.deleteLocalCount > 0) {
			ul.createEl("li", { text: `Delete ${b.deleteLocalCount} local files` });
		}
		if (b.deleteRemoteCount > 0) {
			ul.createEl("li", { text: `Delete ${b.deleteRemoteCount} remote files` });
		}
		if (b.pullCount > 0) {
			ul.createEl("li", { text: `Download ${b.pullCount} files from server` });
		}
		if (b.pushCount > 0) {
			ul.createEl("li", { text: `Upload ${b.pushCount} files to server` });
		}

		const deletePaths = this.deletePathsFor(choice);
		if (deletePaths.length > 0) {
			contentEl.createEl("p", {
				text: "Files marked for deletion:",
				cls: "engram-sync-preview-tree-caption",
			});
			this.renderDeletionTree(contentEl, deletePaths, this.keptPathsFor(choice, deletePaths));
		}

		contentEl.createEl("p", {
			cls: "engram-sync-preview-warning",
			text: "This cannot be undone.",
		});
		contentEl.createEl("p", { text: "Type delete to confirm:" });

		const input = contentEl.createEl("input", {
			type: "text",
			cls: "engram-sync-preview-confirm-input",
		});

		const footer = contentEl.createDiv({ cls: "engram-sync-preview-footer" });
		const backBtn = footer.createEl("button", { text: "Back" });
		backBtn.addEventListener("click", () => {
			this.state.goBack();
			this.render();
		});

		const confirmBtn = footer.createEl("button", {
			text: "Confirm",
			cls: "engram-sync-preview-confirm-btn",
		});
		confirmBtn.disabled = true;
		confirmBtn.addEventListener("click", () => this.state.submitConfirm());

		input.addEventListener("input", () => {
			this.state.typeConfirm(input.value);
			confirmBtn.disabled = !this.state.canSubmitConfirm();
		});

		input.focus();
	}

	private renderVaultPicker(): void {
		if (this.state.creatingVault) {
			this.renderCreateVaultForm();
			return;
		}

		const { contentEl } = this;
		contentEl.createEl("h2", {
			text: "Switch vault",
			cls: "engram-sync-preview-header",
		});
		contentEl.createEl("p", {
			text: "Pick a vault to sync with. We will recalculate the sync preview after you choose.",
			cls: "engram-sync-preview-picker-help",
		});

		const body = contentEl.createDiv({ cls: "engram-sync-preview-picker-body" });

		if (this.state.vaultsLoading) {
			body.createEl("p", { text: "Loading vaults…" });
		} else if (this.state.vaultsError) {
			body.createEl("p", {
				text: this.state.vaultsError,
				cls: "engram-sync-preview-picker-error",
			});
		} else if (this.state.vaults && this.state.vaults.length > 0) {
			const list = body.createDiv({ cls: "engram-sync-preview-picker-list" });
			for (const v of this.state.vaults) {
				const item = list.createEl("button", {
					cls: "engram-sync-preview-picker-item",
				});
				item.createSpan({
					text: v.name,
					cls: "engram-sync-preview-picker-item-name",
				});
				if (v.is_default) {
					item.createSpan({
						text: " (default)",
						cls: "engram-sync-preview-picker-item-default",
					});
				}
				item.addEventListener("click", () => {
					void this.applyPickedVault(v);
				});
			}
		} else {
			body.createEl("p", { text: "No other vaults available." });
		}

		const footer = contentEl.createDiv({ cls: "engram-sync-preview-footer" });
		const backBtn = footer.createEl("button", { text: "Back" });
		backBtn.addEventListener("click", () => {
			this.state.exitVaultPicker();
			this.render();
		});

		if (this.opts.createVault) {
			const newBtn = footer.createEl("button", {
				text: "Make new vault",
				cls: "mod-cta engram-sync-preview-new-vault-btn",
			});
			newBtn.addEventListener("click", () => {
				this.state.enterCreateVault();
				this.render();
			});
		}
	}

	/** Render the "make a new vault" form: a name field pre-filled with the
	 *  Obsidian vault name, plus Create / Back. Submitting creates the vault and
	 *  immediately selects it (which recomputes the preview for the empty vault). */
	private renderCreateVaultForm(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", {
			text: "New vault",
			cls: "engram-sync-preview-header",
		});
		contentEl.createEl("p", {
			text: "Create a new empty vault on the server, then sync this Obsidian vault into it.",
			cls: "engram-sync-preview-picker-help",
		});

		const body = contentEl.createDiv({ cls: "engram-sync-preview-picker-body" });

		if (this.state.vaultsError) {
			body.createEl("p", {
				text: this.state.vaultsError,
				cls: "engram-sync-preview-picker-error",
			});
		}

		const input = body.createEl("input", {
			type: "text",
			cls: "engram-sync-preview-new-vault-input",
		});
		input.value = this.app.vault.getName();
		input.placeholder = "Vault name";

		const footer = contentEl.createDiv({ cls: "engram-sync-preview-footer" });
		const backBtn = footer.createEl("button", { text: "Back" });
		backBtn.addEventListener("click", () => {
			this.state.exitCreateVault();
			this.render();
		});

		const createBtn = footer.createEl("button", {
			text: "Create",
			cls: "mod-cta",
		});
		const submit = () => {
			if (this.state.vaultsLoading) return;
			void this.applyCreateVault(input.value);
		};
		createBtn.addEventListener("click", submit);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") submit();
		});
	}

	private async openVaultPicker(): Promise<void> {
		if (!this.opts.listVaults) return;
		this.state.enterVaultPicker();
		this.render();
		try {
			const vaults = await this.opts.listVaults();
			this.state.onVaultsLoaded(vaults);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : "Could not load vaults";
			this.state.onVaultsError(msg);
		}
		this.render();
	}

	private deletePathsFor(choice: SyncChoice): string[] {
		const plan = this.requirePlan();
		if (choice === "pull-all-delete-local") {
			return [...plan.toPush.notes, ...plan.toPush.attachments];
		}
		if (choice === "push-all-delete-remote") {
			return [...plan.toPull.notes, ...plan.toPull.attachments];
		}
		return [];
	}

	/** Paths that remain on the affected side after the destructive sync —
	 *  used to decide whether a folder row is going away entirely. */
	private keptPathsFor(choice: SyncChoice, deletePaths: string[]): string[] {
		const plan = this.requirePlan();
		const deleted = new Set(deletePaths);
		if (choice === "pull-all-delete-local") {
			return plan.localPaths.filter((p) => !deleted.has(p));
		}
		if (choice === "push-all-delete-remote") {
			return plan.serverPaths.filter((p) => !deleted.has(p));
		}
		return [];
	}

	private renderDeletionTree(parent: HTMLElement, paths: string[], keptPaths: string[]): void {
		const pre = parent.createEl("pre", { cls: "engram-sync-preview-tree" });
		const code = pre.createEl("code");
		const rows = buildDeletionTree(paths, keptPaths);
		for (const row of rows) {
			let cls = "engram-sync-preview-tree-row";
			if (row.kind === "file") {
				cls += " engram-sync-preview-tree-file";
			} else if (row.deleted) {
				cls += " engram-sync-preview-tree-folder engram-sync-preview-tree-folder-deleted";
			} else {
				cls += " engram-sync-preview-tree-folder";
			}
			const line = code.createDiv({ cls });
			line.setText(`${"  ".repeat(row.depth)}${row.label}`);
		}
	}

	private async applyCreateVault(name: string): Promise<void> {
		if (!this.opts.createVault) return;
		const trimmed = name.trim();
		if (!trimmed) {
			this.state.onVaultsError("Enter a name for the new vault");
			this.state.creatingVault = true; // onVaultsError doesn't touch this flag; stay on the form
			this.render();
			return;
		}
		this.state.vaultsLoading = true;
		this.render();
		let created: VaultInfo;
		try {
			created = await this.opts.createVault(trimmed);
		} catch (e: unknown) {
			this.state.vaultsLoading = false;
			this.state.onVaultsError(describeCreateVaultError(e));
			this.state.creatingVault = true; // remain on the form so the user can retry
			this.render();
			return;
		}
		// Select the new (empty) vault — applyPickedVault switches and recomputes
		// the preview, which will offer push-all against the empty remote.
		this.state.exitCreateVault();
		await this.applyPickedVault(created);
	}

	private async applyPickedVault(v: VaultInfo): Promise<void> {
		if (!this.opts.applyVaultChange) return;
		this.state.vaultsLoading = true;
		this.render();
		try {
			const newPlan = await this.opts.applyVaultChange(v.id, v.name);
			this.state.replacePlan(newPlan);
			this.remoteVaultName = v.name;
			this.state.exitVaultPicker();
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : "Failed to switch vault";
			this.state.onVaultsError(msg);
		}
		this.render();
	}
}

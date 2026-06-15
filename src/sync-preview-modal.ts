import { type App, Modal } from "obsidian";
import { toastFor } from "./limit-copy";
import { LimitExceededError } from "./limit-error";
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
	/** Mutable so the modal can swap in a fresh plan after applyVaultChange. */
	plan: SyncPlan;
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
		initialPlan: SyncPlan,
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

	/** Swap in the SyncPlan that came back from applyVaultChange. Caller is
	 *  responsible for re-rendering. */
	replacePlan(plan: SyncPlan): void {
		this.plan = plan;
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

interface OptionCard {
	choice: SyncChoice;
	emoji: string;
	label: string;
	subtitle: (b: OptionBreakdown) => string;
	cssClass: string;
}

const MERGE_CARD: OptionCard = {
	choice: "smart-merge",
	emoji: "✨",
	label: "Sync",
	subtitle: () => "Keep files from both sides; resolve conflicts as they appear",
	cssClass: "engram-sync-preview-option mod-cta",
};

const PUSH_CARDS: OptionCard[] = [
	{
		choice: "push-all-keep-remote",
		emoji: "⬆️",
		label: "Push all + keep remote",
		subtitle: (b) => `Upload ${b.pushCount}, keep remote extras`,
		cssClass: "engram-sync-preview-option",
	},
	{
		choice: "push-all-delete-remote",
		emoji: "⚠️",
		label: "Push all + delete remote",
		subtitle: (b) => `Upload ${b.pushCount}, delete ${b.deleteRemoteCount} remote`,
		cssClass: "engram-sync-preview-option engram-sync-preview-destructive",
	},
];

const PULL_CARDS: OptionCard[] = [
	{
		choice: "pull-all-keep-local",
		emoji: "⬇️",
		label: "Pull all + keep local",
		subtitle: (b) => `Download ${b.pullCount}, keep local extras`,
		cssClass: "engram-sync-preview-option",
	},
	{
		choice: "pull-all-delete-local",
		emoji: "⚠️",
		label: "Pull all + delete local",
		subtitle: (b) => `Download ${b.pullCount}, delete ${b.deleteLocalCount} local`,
		cssClass: "engram-sync-preview-option engram-sync-preview-destructive",
	},
];

const HEADER_BY_CONTEXT: Record<SyncPreviewContext, string> = {
	"first-time": "Set up sync for this vault",
	"vault-switch": "New vault detected",
	review: "Sync preview",
};

const OPTIONS_HEADER_BY_CONTEXT: Record<SyncPreviewContext, string> = {
	"first-time": "Choose from the following first-time sync options",
	"vault-switch": "Choose how to sync this new vault",
	review: "Choose a sync direction",
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
		plan: SyncPlan,
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
		const empty = isPlanEmpty(this.state.plan);
		const context = this.opts.context ?? "review";

		this.renderHeader(contentEl, empty ? "up-to-date" : context);
		this.renderComparison(contentEl);

		const options = contentEl.createDiv({ cls: "engram-sync-preview-options" });
		// When already in sync there's no direction to "choose" — drop the prompt
		// but still offer Sync + the (collapsed) advanced options for a deliberate
		// force push/pull or recovery.
		if (!empty) {
			options.createDiv({
				cls: "engram-sync-preview-options-header",
				text: OPTIONS_HEADER_BY_CONTEXT[context],
			});
		}

		const mergeRow = options.createDiv({ cls: "engram-sync-preview-options-merge" });
		this.renderOptionCard(mergeRow, MERGE_CARD);

		this.renderAdvancedOptions(options);

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

	/** Render the "Show advanced sync options" accordion (collapsed by default)
	 *  with the push/pull direction grid. Shared by the up-to-date and
	 *  has-changes preview states so force push/pull stays reachable even at
	 *  100% match. */
	private renderAdvancedOptions(options: HTMLElement): void {
		const advancedToggle = options.createEl("button", {
			cls: "engram-sync-preview-advanced-toggle",
		});
		advancedToggle.createSpan({
			cls: "engram-sync-preview-advanced-chevron",
			text: this.state.advancedOpen ? "▾" : "▸",
		});
		advancedToggle.createSpan({ text: "Show advanced sync options" });
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
			this.renderOptionCard(pushCol, card);
		}

		const pullCol = grid.createDiv({ cls: "engram-sync-preview-options-col" });
		pullCol.createDiv({
			text: "Pull (cloud → local)",
			cls: "engram-sync-preview-options-col-header",
		});
		for (const card of PULL_CARDS) {
			this.renderOptionCard(pullCol, card);
		}
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
		const plan = this.state.plan;

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
		const matchValue = matchRow.createSpan({
			cls: "engram-sync-preview-match-value",
			text: `${match}%`,
		});
		if (match === 100) matchValue.addClass("is-perfect");
		matchRow.createSpan({
			cls: "engram-sync-preview-match-label",
			text: " of vaults currently match",
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

	private renderOptionCard(parent: HTMLElement, card: OptionCard): void {
		const b = optionBreakdown(this.state.plan, card.choice);
		const wrap = parent.createDiv({ cls: "engram-sync-preview-option-wrap" });
		const btn = wrap.createEl("button", { cls: card.cssClass });
		btn.createSpan({ text: card.emoji, cls: "engram-sync-preview-option-emoji" });
		btn.createSpan({ text: card.label, cls: "engram-sync-preview-option-label" });
		wrap.createEl("p", {
			text: card.subtitle(b),
			cls: "engram-sync-preview-option-subtitle",
		});
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

		const b = optionBreakdown(this.state.plan, choice);
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
		const plan = this.state.plan;
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
		const plan = this.state.plan;
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

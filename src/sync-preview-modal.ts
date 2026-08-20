import { type App, Modal, setIcon } from "obsidian";
import { statusOf } from "./error-util";
import { toastFor } from "./limit-copy";
import { LimitExceededError } from "./limit-error";
import { isTextAttachment } from "./mime";
import {
	buildDeletionTree,
	computeMatchPercent,
	isDestructiveChoice,
	isPlanEmpty,
	type OptionBreakdown,
	optionBreakdown,
	plural,
	pluralWord,
	simplifiedFirstSync,
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
	/** Stable across retries of ONE create-vault form session — see
	 *  enterCreateVault. Null when not on the form. */
	createVaultClientId: string | null = null;
	/** Guards against a second submit landing while the first POST is still in
	 *  flight. `vaultsLoading` is a RENDER flag, not a lock. */
	createVaultInFlight = false;
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
		// Minted ONCE per visit to the form, not per submit. That is what makes a
		// retry idempotent: the same client_id resolves to the same vault
		// server-side, so a double-submit returns the first vault instead of
		// creating a second one.
		this.createVaultClientId = crypto.randomUUID();
	}

	exitCreateVault(): void {
		this.creatingVault = false;
		this.vaultsError = null;
		this.createVaultClientId = null;
		this.createVaultInFlight = false;
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

/** Plan-load failure copy for the preview modal. Auth state decides the
 *  message: blaming the connection when the real problem is a dead login sent
 *  the 2026-08-12 incident user into a retry limbo — the signed-out copy must
 *  say "sign in", never "check your connection". Pure for testing. */
export function planLoadErrorMessage(hasAuth: boolean): string {
	return hasAuth
		? "Could not compare with the cloud. Check your connection."
		: "Your login expired. Sign in again in Engram settings to continue.";
}

/** Map a createVault rejection to a short human label. LimitExceededError =
 *  402 from the standardized backend body (spec §4.6), 422 = validation
 *  (e.g. duplicate/empty name), else a generic connection message. Pure
 *  for testing. */
export function describeCreateVaultError(e: unknown): string {
	if (e instanceof LimitExceededError) return toastFor(e.reason);
	const status = statusOf(e);
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
	const noun = pluralWord(n, "attachment");
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

/** The "You are about to:" lines for a destructive sync's confirm screen, built
 *  from the plan. Both destructive options wipe the ENTIRE target side and then
 *  re-populate it, so the deletion line reports the full target count, not just
 *  net extras — otherwise a destructive button could show no deletion at all
 *  when the two sides already overlap. Pure for testing. */
export function confirmActions(choice: SyncChoice, plan: SyncPlan): string[] {
	const files = (n: number) => pluralWord(n, "file");
	const lines: string[] = [];
	if (choice === "push-all-delete-remote") {
		const del = plan.serverNoteCount + plan.serverAttachmentCount;
		const up = plan.localNoteCount + plan.localAttachmentCount;
		if (del > 0) lines.push(`Delete all ${del} ${files(del)} currently on the server`);
		if (up > 0) lines.push(`Upload ${up} ${files(up)} from this vault`);
	} else if (choice === "pull-all-delete-local") {
		const del = plan.localNoteCount + plan.localAttachmentCount;
		const down = plan.serverNoteCount + plan.serverAttachmentCount;
		if (del > 0) lines.push(`Delete all ${del} ${files(del)} in this vault`);
		if (down > 0) lines.push(`Download ${down} ${files(down)} from the server`);
	}
	return lines;
}

interface OptionCard {
	choice: SyncChoice;
	emoji: string;
	label: string;
	cssClass: string;
}

const MERGE_CARD: OptionCard = {
	choice: "smart-merge",
	emoji: "✨",
	label: "Sync",
	cssClass: "engram-sync-preview-option mod-cta",
};

const PUSH_CARDS: OptionCard[] = [
	{
		choice: "push-all-keep-remote",
		emoji: "⬆️",
		label: "Upload local files without downloading the remote",
		cssClass: "engram-sync-preview-option",
	},
	{
		choice: "push-all-delete-remote",
		emoji: "🗑️",
		label: "Delete all on remote, then upload local files",
		cssClass: "engram-sync-preview-option engram-sync-preview-destructive",
	},
];

const PULL_CARDS: OptionCard[] = [
	{
		choice: "pull-all-keep-local",
		emoji: "⬇️",
		label: "Download remote files without uploading the local",
		cssClass: "engram-sync-preview-option",
	},
	{
		choice: "pull-all-delete-local",
		emoji: "🗑️",
		label: "Delete all local files, then download from remote",
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
	/** Is the sync gate currently CLOSED — i.e. does walking away from this
	 *  modal leave the vault syncing nothing?
	 *
	 *  Separate from `context` on purpose. `context` answers "what should the
	 *  header say", and it never carries "review" from the first-sync path
	 *  (derivePreviewContext only returns first-time / vault-switch), so keying
	 *  the gate warning and the empty-plan action off it told an already-syncing
	 *  user that nothing would sync, and ran a pointless full sync on dismiss.
	 *  Callers pass syncEngine.isSyncBlocked(), which is the actual fact. */
	gateClosed?: boolean;
	/** Fetches the list of vaults the user can switch to. Called when the
	 *  user presses Change Vault. Required when showChangeVault is true. */
	listVaults?: () => Promise<VaultInfo[]>;
	/** Persists a vault switch and returns the new SyncPlan so the modal can
	 *  re-render in place. Required when showChangeVault is true. */
	applyVaultChange?: (id: string, name: string) => Promise<SyncPlan>;
	/** Creates a brand-new vault and returns it. When provided, the picker shows
	 *  a "Make new vault" affordance. The created vault is then selected via
	 *  applyVaultChange so the preview recalculates against the empty remote. */
	createVault?: (name: string, clientId: string) => Promise<VaultInfo>;
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

/** The one-click screen's copy, pure for tests. Zero-count clauses are
 *  dropped ("0 notes" never renders — review finding), and the no-deletion
 *  note is scoped to THIS DEVICE: that claim is verifiable (the dirty-plan
 *  guard in simplifiedFirstSync excludes pending local deletions), while the
 *  old absolute "Nothing will be deleted" could be falsified by queued
 *  offline deletes tombstoning the server after the promise. */
export function simplifiedScreenCopy(simple: NonNullable<ReturnType<typeof simplifiedFirstSync>>): {
	body: string;
	action: string;
	note: string | null;
} {
	if (simple.mode === "fresh") {
		return {
			body: "Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.",
			action: "Start syncing",
			note: null,
		};
	}
	const parts: string[] = [];
	if (simple.notes > 0) parts.push(plural(simple.notes, "note"));
	if (simple.attachments > 0) parts.push(plural(simple.attachments, "attachment"));
	const what = parts.join(" and ") || "files";
	if (simple.mode === "upload") {
		return {
			body: `This vault is empty on the server. Upload your ${what}?`,
			action: "Upload everything",
			note: "Nothing will be removed from this device.",
		};
	}
	return {
		body: `This device's vault is empty. Download ${what} from the server?`,
		action: "Download everything",
		note: "Nothing will be removed from this device.",
	};
}

/** Wait this long before the "Comparing…" line appears. Plans that resolve
 *  faster show no loading copy at all. */
const LOADING_TEXT_DELAY_MS = 400;
/** Once that line IS on screen, keep it there at least this long. */
const LOADING_MIN_VISIBLE_MS = 600;

/** What the button on the "nothing to sync" screen should say and do.
 *
 *  Both sides already match, so there is no transfer to run — but in a GATED
 *  context the sync gate still has to be accepted or the plugin stays inert.
 *  "Close" used to dispatch `cancel`, which returns false from
 *  runSyncFromChoice and never reaches markSyncGateAccepted: a user whose
 *  vault was already in sync from another device clicked the one obvious
 *  button and silently ended up with sync blocked forever.
 *
 *  With the gate already open there genuinely is nothing to do, so plain
 *  dismissal is correct. */
export function emptyPlanDismiss(gateClosed: boolean): {
	label: string;
	accept: boolean;
} {
	return gateClosed ? { label: "Done", accept: true } : { label: "Close", accept: false };
}

/** How long to hold the loaded plan back so the "Comparing…" line stays
 *  readable. 0 when the line was never shown (the fast path — nothing to
 *  hold) or has already had its time.
 *
 *  Deliberately NOT a blanket delay on every sync: the fast case should feel
 *  instant, and only a line that actually reached the screen has earned the
 *  right to stay on it. */
export function loadingHoldMs(shownAt: number | null, now: number): number {
	if (shownAt === null) return 0;
	const held = now - shownAt;
	return held >= LOADING_MIN_VISIBLE_MS ? 0 : LOADING_MIN_VISIBLE_MS - held;
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

	private loadingTextTimer: number | null = null;
	private holdTimer: number | null = null;
	/** null until the "Comparing…" line is actually on screen. Doubles as the
	 *  flag renderPlanLoading reads and the clock the hold window measures. */
	private loadingTextShownAt: number | null = null;

	onOpen(): void {
		this.contentEl.addClass("engram-sync-preview-modal");
		this.contentEl.addClass("engram-flow-modal");
		this.startLoadingTextTimer();
		if (this.opts.initialView === "vault-picker") {
			void this.openVaultPicker();
		} else {
			this.render();
		}
	}

	onClose(): void {
		this.clearLoadingTimers();
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

		// If "Comparing…" is on screen, let it be readable. Swapping it out
		// after 80ms is what made the step feel skipped rather than fast.
		const hold = loadingHoldMs(this.loadingTextShownAt, Date.now());
		if (hold > 0) {
			this.holdTimer = window.setTimeout(() => {
				this.holdTimer = null;
				this.applyPlan(plan);
			}, hold);
			return;
		}

		this.applyPlan(plan);
	}

	private applyPlan(plan: SyncPlan): void {
		if (this.state.plan != null) return;
		this.clearLoadingTimers();
		this.state.replacePlan(plan);
		if (this.state.view === "preview") this.render();
	}

	/** The loading LINE is deferred, not the modal — the modal itself opens
	 *  instantly and keeps its header/footer the whole time. A plan that
	 *  resolves inside this window therefore shows no loading copy at all,
	 *  which is the point: a sentence displayed for 80ms is a flicker, not
	 *  information. Slowing every sync down to make it readable would tax the
	 *  fast path forever to fix a frame nobody wanted. */
	private startLoadingTextTimer(): void {
		if (this.state.plan != null) return;
		this.loadingTextTimer = window.setTimeout(() => {
			this.loadingTextTimer = null;
			if (this.state.plan != null) return;
			this.loadingTextShownAt = Date.now();
			if (this.state.view === "preview") this.render();
		}, LOADING_TEXT_DELAY_MS);
	}

	private clearLoadingTimers(): void {
		if (this.loadingTextTimer !== null) {
			window.clearTimeout(this.loadingTextTimer);
			this.loadingTextTimer = null;
		}
		if (this.holdTimer !== null) {
			window.clearTimeout(this.holdTimer);
			this.holdTimer = null;
		}
	}

	/** Surface a plan-load failure in the instant-open loading view. Skipped once
	 *  a plan exists (e.g. the user switched vaults), so a stale failure never
	 *  overwrites a good plan. */
	setPlanError(message: string): void {
		if (this.state.plan != null) return;
		this.clearLoadingTimers();
		// An error is not a progress message — show it the instant it exists,
		// regardless of where the delay window stands.
		this.loadingTextShownAt = Date.now();
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

		// One-click first-sync screens: when one side is empty there is exactly
		// one sane action, so skip the five-option ceremony (delete variants are
		// a foot-gun on an onboarding screen). Both sides populated → the full
		// preview below — the only case a human needs to weigh.
		const simple = simplifiedFirstSync(this.state.plan);
		// "fresh" in a review context is just an up-to-date linked vault — the
		// regular preview's up-to-date header is the right screen, not a
		// "Start syncing" pitch (review finding).
		if (simple && (simple.mode !== "fresh" || context !== "review")) {
			this.renderSimplified(contentEl, simple, context);
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
		this.renderOptionCard(mergeRow, MERGE_CARD);

		this.renderAdvancedOptions(options);

		if (empty) {
			// Accepting the gate is the whole job on this screen — see
			// emptyPlanDismiss. smart-merge is a no-op transfer here (the sides
			// match) that routes through markSyncGateAccepted.
			const { label, accept } = emptyPlanDismiss(this.opts.gateClosed ?? false);
			this.renderFooter(
				contentEl,
				label,
				true,
				accept ? () => this.state.pickOption("smart-merge") : undefined,
			);
			return;
		}
		this.renderFooter(contentEl, "Cancel", false);
	}

	/** The one-click screen for an empty-side first sync. One primary action
	 *  (always smart-merge — non-destructive by construction), plus the footer's
	 *  Cancel / Change vault. See simplifiedFirstSync for the decision. */
	private renderSimplified(
		parent: HTMLElement,
		simple: NonNullable<ReturnType<typeof simplifiedFirstSync>>,
		context: SyncPreviewContext,
	): void {
		this.renderHeader(parent, context);
		const box = parent.createDiv({ cls: "engram-sync-preview-simple" });
		const copy = simplifiedScreenCopy(simple);
		box.createEl("p", { text: copy.body, cls: "engram-sync-preview-simple-body" });
		if (copy.note) {
			box.createEl("p", {
				text: copy.note,
				cls: "engram-sync-preview-simple-note",
			});
		}
		const btn = box.createEl("button", {
			text: copy.action,
			cls: "engram-sync-preview-simple-action mod-cta",
		});
		btn.addEventListener("click", () => {
			// Always the non-destructive merge: on an empty remote it uploads
			// everything, on an empty device it downloads everything.
			// pickOption("smart-merge") starts the sync and closes this modal —
			// no re-render needed (smart-merge never hits the confirm view).
			this.state.pickOption("smart-merge");
		});
		this.renderSkippedAttachmentsNote(parent);
		this.renderFooter(parent, "Cancel", false);
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
		} else if (this.loadingTextShownAt !== null) {
			body.createSpan({ text: "Comparing your vault with the cloud…" });
		}

		this.renderFooter(parent, "Cancel", false);
	}

	/** Dismiss + optional "Change vault" footer, shared by the loaded preview
	 *  and the loading state (previously identical blocks). */
	private renderFooter(
		parent: HTMLElement,
		dismissLabel: string,
		dismissCta: boolean,
		dismissAction?: () => void,
	): void {
		// "review" is a manual sync with the gate already open — walking away
		// costs nothing. The other contexts are opened BY the closed gate, and
		// that gate stops every sync path, not just this run: dismiss here and
		// the vault silently syncs nothing at all, forever, until it is resolved.
		//
		// So say that at the decision point rather than after it, and drop the
		// word "Cancel" — there is no operation in flight to cancel, and the
		// choice is genuinely deferrable.
		//
		// Skipped when dismissCta: that is the nothing-to-sync screen, where the
		// button is the primary action and there is no choice being deferred.
		const gated = (this.opts.gateClosed ?? false) && !dismissCta;
		if (gated) {
			parent.createEl("p", {
				cls: "engram-sync-preview-gate-note",
				text: "Until you choose, nothing in this vault will sync.",
			});
		}

		const footer = parent.createDiv({ cls: "engram-sync-preview-footer" });
		const dismissBtn = footer.createEl("button", {
			text: gated ? "Not now" : dismissLabel,
			cls: dismissCta ? "mod-cta" : undefined,
		});
		dismissBtn.addEventListener("click", () => {
			if (dismissAction) {
				dismissAction();
				return;
			}
			this.state.cancel();
		});
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

	/** Render the advanced sync options as a native <details> accordion holding
	 *  all four direction buttons in one column. Collapsed by default; stays
	 *  reachable even at 100% match for a deliberate force push/pull or recovery. */
	private renderAdvancedOptions(options: HTMLElement): void {
		const details = options.createEl("details", { cls: "engram-sync-preview-advanced" });
		details.open = this.state.advancedOpen;

		const summary = details.createEl("summary", {
			cls: "engram-sync-preview-advanced-summary",
		});
		summary.createSpan({ text: "Advanced sync options" });
		const chevron = summary.createSpan({ cls: "engram-sync-preview-advanced-chevron" });
		setIcon(chevron, this.state.advancedOpen ? "chevron-down" : "chevron-right");

		// The native <details> owns open/close — just persist the state and swap
		// the chevron on toggle, no full re-render so the disclosure stays smooth.
		details.addEventListener("toggle", () => {
			this.state.advancedOpen = details.open;
			setIcon(chevron, details.open ? "chevron-down" : "chevron-right");
		});

		const grid = details.createDiv({ cls: "engram-sync-preview-options-grid" });
		for (const card of [...PUSH_CARDS, ...PULL_CARDS]) {
			this.renderOptionCard(grid, card);
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
				text: ` ${pluralWord(conflicts, "conflict")} need resolution`,
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
		const wrap = parent.createDiv({ cls: "engram-sync-preview-option-wrap" });
		const btn = wrap.createEl("button", { cls: card.cssClass });
		btn.createSpan({ text: card.emoji, cls: "engram-sync-preview-option-emoji" });
		btn.createSpan({ text: card.label, cls: "engram-sync-preview-option-label" });
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

		const summary = contentEl.createDiv({ cls: "engram-sync-preview-confirm-summary" });
		summary.createEl("p", { text: "You are about to:" });
		const ul = summary.createEl("ul");
		for (const action of confirmActions(choice, this.requirePlan())) {
			ul.createEl("li", { text: action });
		}

		const deletePaths = this.deletePathsFor(choice);
		if (deletePaths.length > 0) {
			contentEl.createEl("p", {
				text: "Files that will be deleted:",
				cls: "engram-sync-preview-tree-caption",
			});
			this.renderDeletionTree(contentEl, deletePaths, this.keptPathsFor(choice, deletePaths));
		}

		contentEl.createEl("p", {
			cls: "engram-sync-preview-warning",
			text: "This cannot be undone.",
		});
		const typeLine = contentEl.createEl("p");
		typeLine.createSpan({ text: "Type " });
		typeLine.createSpan({ text: "delete", cls: "engram-sync-preview-confirm-keyword" });
		typeLine.createSpan({ text: " to confirm:" });

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

	/** Every path that the destructive sync deletes. Both options wipe the whole
	 *  target side (then re-populate it), so this is the entire local/server file
	 *  list — matching the "Delete all N" line on the confirm screen. */
	private deletePathsFor(choice: SyncChoice): string[] {
		const plan = this.requirePlan();
		if (choice === "pull-all-delete-local") {
			return [...plan.localPaths];
		}
		if (choice === "push-all-delete-remote") {
			return [...plan.serverPaths];
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
		// A second submit while the first POST is still open creates a SECOND
		// vault: observed 2026-08-20, one sync producing two vaults (292 notes
		// orphaned, 319 re-uploaded into the replacement). vaultsLoading only
		// drives rendering, so it cannot serve as the lock.
		if (this.state.createVaultInFlight) return;
		this.state.createVaultInFlight = true;

		const clientId = this.state.createVaultClientId ?? crypto.randomUUID();
		this.state.createVaultClientId = clientId;

		this.state.vaultsLoading = true;
		this.render();
		let created: VaultInfo;
		try {
			created = await this.opts.createVault(trimmed, clientId);
		} catch (e: unknown) {
			this.state.createVaultInFlight = false;
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

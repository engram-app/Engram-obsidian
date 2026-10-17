import { type App, Modal, setIcon } from "obsidian";
import { withTimeout } from "./api";
import { devLog } from "./dev-log";
import { errMsg, statusOf } from "./error-util";
import { FolderPicker, ROOT_FOLDER, selectedNoteCount } from "./folder-picker";
import { asIs, t, tInto } from "./i18n";
import { userErrorMessage } from "./i18n/user-error";
import { toastFor } from "./limit-copy";
import { LimitExceededError } from "./limit-error";
import { isTextAttachment } from "./mime";
import { type BillingUsage, isUnlimited } from "./plan-usage";
import type { FolderAction, FolderPlan } from "./sync";
import {
	buildDeletionTree,
	computeMatchPercent,
	isDestructiveChoice,
	isPlanEmpty,
	type OptionBreakdown,
	optionBreakdown,
	planWithoutFolders,
	simplifiedFirstSync,
} from "./sync-plan-format";
import type { SyncChoice, SyncPlan, SyncPreviewContext, VaultInfo } from "./types";

/** The word a destructive sync makes the user type. Deliberately not
 *  translated: it is an exact token checked below, not prose. */
const CONFIRM_KEYWORD = "delete";

/** Pure state machine for the SyncPreviewModal. Owns view + input state and
 *  the resolve callback. Tested directly; the Modal class is a thin DOM
 *  wrapper that delegates to it. */
export class SyncPreviewState {
	view: "preview" | "confirm" | "vault-picker" | "over-limit" | "done" = "preview";
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
	/** First-run diagnostics opt-in checkbox (see shouldOfferDiagnosticsOptIn).
	 *  Off by default. Explicit consent, not an assumed default. */
	diagnosticsOptIn = false;
	/** The plan's notes limit and the room left under it, or null when
	 *  unlimited or unknown (the usage call failed or has not answered yet).
	 *  Null never shows the over-limit step: it must not be able to block a sync. */
	notesQuota: NotesQuota | null = null;
	/** Top-level folders unticked in the over-limit step's folder picker. */
	overLimitExcluded: string[] = [];
	/** "I understand N notes will not sync." Reset whenever N changes. */
	overLimitAck = false;
	/** The exclusions are being saved. */
	overLimitSaving = false;
	/** The last save failure, kept here so a re-render still shows it. */
	overLimitError: string | null = null;
	/** Set once the user got through the step, so it is asked once per plan. */
	private overLimitDone = false;
	private resolved = false;

	constructor(
		initialPlan: SyncPlan | null,
		private readonly onResolve: (choice: SyncChoice) => void,
	) {
		this.plan = initialPlan;
	}

	pickOption(choice: SyncChoice): void {
		if (this.resolved) return;
		if (this.needsOverLimitStep(choice)) {
			this.pendingChoice = choice;
			this.view = "over-limit";
			return;
		}
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
		return this.view === "confirm" && this.confirmInput === CONFIRM_KEYWORD;
	}

	submitConfirm(): void {
		if (!this.canSubmitConfirm() || this.pendingChoice == null) return;
		this.resolve(this.pendingChoice);
	}

	setNotesQuota(quota: NotesQuota | null): void {
		const over = this.overLimitOver();
		this.notesQuota = quota;
		if (this.overLimitOver() !== over) this.overLimitAck = false;
	}

	/** The over-limit step may only offer the folder picker when ignoring a
	 *  folder cannot delete anything: see deletesRemote. */
	overLimitOffersPicker(): boolean {
		return this.pendingChoice != null && !deletesRemote(this.pendingChoice);
	}

	needsOverLimitStep(choice: SyncChoice): boolean {
		return (
			!this.overLimitDone &&
			uploadsNotes(choice) &&
			this.notesQuota != null &&
			this.addedBy(choice) > this.notesQuota.room
		);
	}

	/** Note paths `choice` would create on the server. push-all re-uploads a
	 *  local note the server tombstoned too (smart-merge lets the delete win). */
	createdPaths(choice: SyncChoice | null): string[] {
		if (choice !== "push-all-keep-remote" && choice !== "push-all-delete-remote") {
			return this.newNotePaths();
		}
		const local = new Set(this.localNotePaths());
		const revived = (this.plan?.toDeleteLocal ?? []).filter((p) => local.has(p));
		return [...this.newNotePaths(), ...revived];
	}

	/** Net notes `choice` adds against the limit: what it creates, less the
	 *  live server notes push-all-delete-remote deletes. */
	addedBy(choice: SyncChoice | null): number {
		const created = this.createdPaths(choice).length;
		if (choice !== "push-all-delete-remote" || !this.plan) return created;
		const local = new Set(this.localNotePaths());
		const serverNotes = this.plan.serverPaths.slice(0, this.plan.serverNoteCount);
		return Math.max(0, created - serverNotes.filter((p) => !local.has(p)).length);
	}

	/** Notes an uploading option would create on the server, as computeSyncPlan
	 *  decides it (one oracle for every option). Edits and attachments do not
	 *  count. */
	newNotePaths(): string[] {
		return this.plan?.newNotePaths ?? [];
	}

	/** Every syncable note on this device, uploaded or not. */
	localNotePaths(): string[] {
		return this.plan?.localNotePaths ?? [];
	}

	setOverLimitExcluded(excluded: string[]): void {
		const over = this.overLimitOver();
		this.overLimitExcluded = excluded;
		if (this.overLimitOver() !== over) this.overLimitAck = false;
	}

	toggleOverLimitAck(): void {
		this.overLimitAck = !this.overLimitAck;
	}

	/** New notes the current folder selection would still add. */
	overLimitAdded(): number {
		// Without a picker no folder can be excluded, whatever was selected before.
		if (!this.overLimitOffersPicker()) return this.addedBy(this.pendingChoice);
		return selectedNoteCount(this.createdPaths(this.pendingChoice), this.overLimitExcluded);
	}

	/** Notes past the room under the current selection; 0 when it fits. */
	overLimitOver(): number {
		return this.notesQuota == null
			? 0
			: Math.max(0, this.overLimitAdded() - this.notesQuota.room);
	}

	canContinueOverLimit(): boolean {
		return (
			this.view === "over-limit" &&
			!this.overLimitSaving &&
			(this.overLimitOver() === 0 || this.overLimitAck)
		);
	}

	/** Back and Continue are inert until endOverLimitSave/finishOverLimit, so
	 *  Back cannot leave saved patterns behind a stale plan. */
	beginOverLimitSave(): void {
		this.overLimitSaving = true;
		this.overLimitError = null;
	}

	/** The save failed: the step is usable again, with `error` on screen. */
	endOverLimitSave(error: string): void {
		this.overLimitSaving = false;
		this.overLimitError = error;
	}

	/** Leave the step and carry on with the option the user picked, exactly as
	 *  if the step had not been there (destructive options still confirm).
	 *  `plan` is the plan minus the folders just excluded, if any. */
	finishOverLimit(plan: SyncPlan | null): void {
		if (this.resolved || this.view !== "over-limit") return;
		// replacePlan clears overLimitDone, so it is set after.
		if (plan) this.replacePlan(plan);
		this.overLimitSaving = false;
		this.overLimitDone = true;
		this.view = "preview";
		const choice = this.pendingChoice;
		this.pendingChoice = null;
		if (choice) this.pickOption(choice);
	}

	/** Back to the options. Over-limit answers belong to the option they were
	 *  given for, so they are dropped and the next pick asks afresh. */
	goBack(): void {
		if (this.resolved || this.overLimitSaving) return;
		this.view = "preview";
		this.pendingChoice = null;
		this.confirmInput = "";
		this.resetOverLimit();
	}

	toggleAdvanced(): void {
		if (this.resolved) return;
		this.advancedOpen = !this.advancedOpen;
	}

	toggleDiagnosticsOptIn(): void {
		if (this.resolved) return;
		this.diagnosticsOptIn = !this.diagnosticsOptIn;
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

	/** Swap in the SyncPlan that came back from applyVaultChange, the deferred
	 *  initial plan once it resolves, or the plan minus excluded folders. Clears
	 *  any prior plan-load error and the over-limit answers (a new plan has new
	 *  notes, so an answer given for the old one no longer holds). Caller is
	 *  responsible for re-rendering. */
	replacePlan(plan: SyncPlan): void {
		this.plan = plan;
		this.planError = null;
		this.resetOverLimit();
	}

	private resetOverLimit(): void {
		this.overLimitDone = false;
		this.overLimitExcluded = [];
		this.overLimitAck = false;
		this.overLimitError = null;
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

/** Whether the first-run diagnostics opt-in checkbox should render. Only the
 *  brand-new-vault setup screen. A returning user picking a sync direction,
 *  or a vault switch, is not the moment to ask for this. Pure for testing. */
export function shouldOfferDiagnosticsOptIn(context: SyncPreviewContext): boolean {
	return context === "first-time";
}

/** Plan-load failure copy for the preview modal. Auth state decides the
 *  message: blaming the connection when the real problem is a dead login sent
 *  the 2026-08-12 incident user into a retry limbo — the signed-out copy must
 *  say "sign in", never "check your connection". Pure for testing. */
export function planLoadErrorMessage(hasAuth: boolean): string {
	return hasAuth
		? t("Could not compare with the cloud. Check your connection.")
		: t("Your login expired. Sign in again in Engram settings to continue.");
}

/** Options that create notes on the server, and so can run past the plan's
 *  notes limit. Pull-only options upload nothing and skip the over-limit step. */
const UPLOADING_CHOICES = new Set<SyncChoice>([
	"smart-merge",
	"push-all-keep-remote",
	"push-all-delete-remote",
]);

export function uploadsNotes(choice: SyncChoice): boolean {
	return UPLOADING_CHOICES.has(choice);
}

/** Options that delete server notes missing from the local snapshot. The
 *  engine keeps ignored paths out of that delete set, but "mirror this vault
 *  to the server" and "leave a folder out" contradict each other, so the
 *  over-limit step offers no folder picker for them. pushAll({replaceRemote})
 *  is the only such path (see optionBreakdown's deleteRemoteCount). */
export function deletesRemote(choice: SyncChoice): boolean {
	return choice === "push-all-delete-remote";
}

/** "This sync adds N notes. Your plan has room for M." as two sentences, each
 *  pluralized by its own count. One string carrying both numbers translated
 *  badly: pt repeated {room}, and its plural form followed {count} alone. */
export function overLimitHeading(count: number, room: number): string {
	return `${t("This sync adds {count} notes.", { count })} ${t("Your plan has room for {count}.", { count: room })}`;
}

/** The notes limit, the room left under it (never negative), and the
 *  server-reported usage (which can exceed the limit). */
export interface NotesQuota {
	limit: number;
	room: number;
	used: number;
}

/** The notes quota from a `/billing/usage` body: "unlimited" only when the
 *  body says so (limit null or negative), null when it is UNKNOWN (no notes
 *  entry, or a limit that is not a number). Pure for testing. */
export function notesQuotaFromUsage(data: BillingUsage): NotesQuota | "unlimited" | null {
	const notes = data.usage?.notes;
	const limit = notes?.limit;
	if (limit === null) return "unlimited";
	if (typeof limit !== "number") return null;
	if (isUnlimited(limit)) return "unlimited";
	const used = notes?.used ?? 0;
	return { limit, room: Math.max(0, limit - used), used };
}

/** The one usage lookup: the quota, "unlimited", or null when unknown (the
 *  call failed or the body is unreadable). Never throws: the over-limit step
 *  is advice, and a failed lookup must never block or delay a sync. */
export async function fetchNotesQuota(
	getUsage: () => Promise<BillingUsage>,
): Promise<NotesQuota | "unlimited" | null> {
	try {
		return notesQuotaFromUsage(await getUsage());
	} catch (e: unknown) {
		devLog().log("error", `billing usage lookup failed: ${errMsg(e)}`);
		return null;
	}
}

/** Map a createVault rejection to a short human label. LimitExceededError =
 *  402 from the standardized backend body (spec §4.6), 422 = validation
 *  (e.g. duplicate/empty name), else a generic connection message. Pure
 *  for testing. */
export function describeCreateVaultError(e: unknown): string {
	if (e instanceof LimitExceededError) return toastFor(e.reason);
	const status = statusOf(e);
	if (status === 422)
		return t("Couldn't create vault — the name may be invalid or already in use.");
	return t("Could not create the vault — check your connection and try again.");
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
	return t("Free syncs notes only — {count} attachments will be skipped.", { count: n });
}

/** Plain-language outcome line for the smart-merge ("Sync") option, computed
 *  from the plan. Smart-merge never deletes, so the line always reassures.
 *  First-time and vault-switch lead with a safety clause for users who do not
 *  yet trust what the button does. Pure for testing. */
export function mergeHelperText(b: OptionBreakdown, context: SyncPreviewContext): string {
	// Whole clauses, joined by a space. Building this from fragments ("Uploads 3"
	// + ", downloads 2") and then upper-casing the first letter assumed English
	// word order AND that capitalization is a string operation, which it is not
	// in every script.
	const countLine =
		b.pushCount > 0 && b.pullCount > 0
			? t("Uploads {up}, downloads {down}.", { up: b.pushCount, down: b.pullCount })
			: b.pushCount > 0
				? t("Will upload {count} files.", { count: b.pushCount })
				: b.pullCount > 0
					? t("Will download {count} files.", { count: b.pullCount })
					: "";
	const conflict =
		b.conflictCount > 0 ? t("{count} conflicts to resolve.", { count: b.conflictCount }) : "";

	if (context === "first-time" || context === "vault-switch") {
		const lead = t("Safe choice: combines both sides, nothing is deleted.");
		return [lead, countLine, conflict].filter(Boolean).join(" ");
	}
	return countLine
		? [countLine, conflict, t("Nothing is deleted.")].filter(Boolean).join(" ")
		: t("Already in sync. Nothing is deleted.");
}

/** The "You are about to:" lines for a destructive sync's confirm screen, built
 *  from the plan. Both destructive options wipe the ENTIRE target side and then
 *  re-populate it, so the deletion line reports the full target count, not just
 *  net extras — otherwise a destructive button could show no deletion at all
 *  when the two sides already overlap. Pure for testing. */
export function confirmActions(choice: SyncChoice, plan: SyncPlan): string[] {
	const lines: string[] = [];
	if (choice === "push-all-delete-remote") {
		const del = plan.serverNoteCount + plan.serverAttachmentCount;
		const up = plan.localNoteCount + plan.localAttachmentCount;
		if (del > 0)
			lines.push(t("Delete all {count} files currently on the server", { count: del }));
		if (up > 0) lines.push(t("Upload {count} files from this vault", { count: up }));
	} else if (choice === "pull-all-delete-local") {
		const del = plan.localNoteCount + plan.localAttachmentCount;
		const down = plan.serverNoteCount + plan.serverAttachmentCount;
		if (del > 0) lines.push(t("Delete all {count} files in this vault", { count: del }));
		if (down > 0) lines.push(t("Download {count} files from the server", { count: down }));
	}
	return lines;
}

interface OptionCard {
	choice: SyncChoice;
	emoji: string;
	label: string;
	cssClass: string;
}

/** Resolved per call, never as a module-scope literal: a literal is
 *  evaluated once at bundle load and freezes to whichever language was active
 *  then. */
function mergeCard(): OptionCard {
	return {
		choice: "smart-merge",
		emoji: "✨",
		label: t("Sync"),
		cssClass: "engram-sync-preview-option mod-cta",
	};
}

function pushCards(): OptionCard[] {
	return [
		{
			choice: "push-all-keep-remote",
			emoji: "⬆️",
			label: t("Upload local files without downloading the remote"),
			cssClass: "engram-sync-preview-option",
		},
		{
			choice: "push-all-delete-remote",
			emoji: "🗑️",
			label: t("Delete all on remote, then upload local files"),
			cssClass: "engram-sync-preview-option engram-sync-preview-destructive",
		},
	];
}

function pullCards(): OptionCard[] {
	return [
		{
			choice: "pull-all-keep-local",
			emoji: "⬇️",
			label: t("Download remote files without uploading the local"),
			cssClass: "engram-sync-preview-option",
		},
		{
			choice: "pull-all-delete-local",
			emoji: "🗑️",
			label: t("Delete all local files, then download from remote"),
			cssClass: "engram-sync-preview-option engram-sync-preview-destructive",
		},
	];
}

/** Resolved per call: as a module-scope literal these froze to whichever
 *  language was active when the bundle was first evaluated. */
export function headerFor(context: SyncPreviewContext): string {
	const headers: Record<SyncPreviewContext, string> = {
		"first-time": t("Set up sync for this vault"),
		"vault-switch": t("You are now pointing at a different cloud vault"),
		review: t("Sync preview"),
	};
	return headers[context];
}

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
	/** Fires live on every checkbox change (not gated on the final sync choice,
	 *  even Cancel should keep the preference). Only rendered/reachable when
	 *  shouldOfferDiagnosticsOptIn(context) is true. */
	onDiagnosticsToggle?: (enabled: boolean) => void;
	/** Billing page for the over-limit step's Upgrade button. Null/omitted on a
	 *  server that sells no plans (see upgradeUrlFor), which hides the button. */
	upgradeUrl?: string | null;
	/** Saves the over-limit step's unticked top-level folders. Only called
	 *  when the user unticked at least one; the modal then filters its own
	 *  plan (planWithoutFolders). `signal` aborts when the modal closes first:
	 *  nothing may be committed. */
	applyExclusions: (folders: string[], signal: AbortSignal) => Promise<void>;
	/** `/billing/usage`, for the notes quota. Fetched on open, again on
	 *  entering the over-limit step and on window focus while it is open (the
	 *  user may have just upgraded in the browser). */
	fetchUsage?: () => Promise<BillingUsage>;
	/** The quota answered after an uploading pick stopped waiting for it, and
	 *  the sync it started adds more notes than the plan has room for. */
	onLateOverLimit?: (quota: NotesQuota) => void;
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
			body: t(
				"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.",
			),
			action: t("Start syncing"),
			note: null,
		};
	}
	const parts: string[] = [];
	if (simple.notes > 0) parts.push(t("{count} notes", { count: simple.notes }));
	if (simple.attachments > 0) parts.push(t("{count} attachments", { count: simple.attachments }));
	const what =
		parts.length === 2
			? t("{first} and {second}", { first: parts[0] ?? "", second: parts[1] ?? "" })
			: (parts[0] ?? t("files"));
	if (simple.mode === "upload") {
		return {
			body: t("This vault is empty on the server. Upload your {what}?", { what }),
			action: t("Upload everything"),
			note: t("Nothing will be removed from this device."),
		};
	}
	return {
		body: t("This device's vault is empty. Download {what} from the server?", { what }),
		action: t("Download everything"),
		note: t("Nothing will be removed from this device."),
	};
}

/** How long an option click waits for the open-time quota lookup before it
 *  proceeds as if the quota were unknown. */
export const QUOTA_WAIT_MS = 3000;

/** An open-time quota answer younger than this is used as is when the step
 *  opens, instead of asking the server again. */
const QUOTA_FRESH_MS = 5000;

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
	return gateClosed ? { label: t("Done"), accept: true } : { label: t("Close"), accept: false };
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
		const fetchUsage = this.opts.fetchUsage;
		if (fetchUsage) {
			const seq = ++this.quotaSeq;
			// On open, unlimited and unknown alike mean no step. A pick made
			// before this answers waits for it (see pick).
			this.quotaPending = fetchNotesQuota(fetchUsage).then((q) => {
				this.quotaPending = null;
				this.quotaAnsweredAt = Date.now();
				if (seq === this.quotaSeq) this.state.setNotesQuota(q === "unlimited" ? null : q);
				if (q && q !== "unlimited") this.onLateQuota(q);
			});
			window.addEventListener("focus", this.onWindowFocus);
		}
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
		this.closed = true;
		this.saving?.abort();
		window.removeEventListener("focus", this.onWindowFocus);
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

	/** The in-flight exclusions save, aborted if the modal closes first. */
	private saving: AbortController | null = null;

	/** Bumped per usage lookup; only the latest lookup's answer applies. */
	private quotaSeq = 0;

	private readonly onWindowFocus = (): void => {
		if (this.state.view === "over-limit") void this.refreshOverLimitQuota();
	};

	/** Re-read the quota while the over-limit step is open. A failed or
	 *  unreadable lookup keeps the step exactly as it is. A plan the server says
	 *  is unlimited has nothing to ask, so the step steps aside, back to the
	 *  options. It never resolves: only the user's own click starts a sync. */
	private async refreshOverLimitQuota(): Promise<void> {
		const fetchUsage = this.opts.fetchUsage;
		if (!fetchUsage) return;
		const seq = ++this.quotaSeq;
		const quota = await fetchNotesQuota(fetchUsage);
		if (quota == null || seq !== this.quotaSeq) return;
		if (this.state.view !== "over-limit" || this.state.overLimitSaving) return;
		if (quota === "unlimited") {
			this.state.setNotesQuota(null);
			this.state.goBack();
		} else {
			this.state.setNotesQuota(quota);
		}
		this.render();
	}

	private render(): void {
		// Resolved: the modal is closing, and "done" has no view of its own.
		if (this.state.view === "done") return;
		const { contentEl } = this;
		contentEl.empty();

		if (this.state.view === "preview") {
			this.renderPreview();
		} else if (this.state.view === "vault-picker") {
			this.renderVaultPicker();
		} else if (this.state.view === "over-limit") {
			this.renderOverLimit();
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

		this.renderDiagnosticsOptIn(options, context);
		const mergeRow = options.createDiv({ cls: "engram-sync-preview-options-merge" });
		this.renderOptionCard(mergeRow, mergeCard());

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
				accept ? () => void this.pick("smart-merge") : undefined,
			);
			return;
		}
		this.renderFooter(contentEl, t("Cancel"), false);
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
		this.renderDiagnosticsOptIn(box, context);
		const btn = box.createEl("button", {
			text: copy.action,
			cls: "engram-sync-preview-simple-action mod-cta",
		});
		btn.addEventListener("click", () => {
			// Always the non-destructive merge: on an empty remote it uploads
			// everything, on an empty device it downloads everything.
			void this.pick("smart-merge", btn);
		});
		this.renderSkippedAttachmentsNote(parent);
		this.renderFooter(parent, t("Cancel"), false);
	}

	/** Opt-in checkbox for shipping anonymous sync diagnostics, offered once on
	 *  first-run setup only (shouldOfferDiagnosticsOptIn). Fires live on every
	 *  change, independent of which sync choice the user eventually makes. */
	private renderDiagnosticsOptIn(parent: HTMLElement, context: SyncPreviewContext): void {
		if (!shouldOfferDiagnosticsOptIn(context)) return;
		const row = parent.createEl("label", { cls: "engram-sync-preview-diagnostics-optin" });
		const checkbox = row.createEl("input", { type: "checkbox" });
		checkbox.checked = this.state.diagnosticsOptIn;
		row.createSpan({
			text: t("Send debug logs. Note content stays private."),
		});
		checkbox.addEventListener("change", () => {
			this.state.toggleDiagnosticsOptIn();
			this.opts.onDiagnosticsToggle?.(this.state.diagnosticsOptIn);
		});
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
			body.createSpan({ text: t("Comparing your vault with the cloud…") });
		}

		this.renderFooter(parent, t("Cancel"), false);
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
		// that gate stops every sync path, not just this run.
		//
		// Drop the word "Cancel" — there is no operation in flight to cancel, and
		// the choice is genuinely deferrable.
		//
		// Skipped when dismissCta: that is the nothing-to-sync screen, where the
		// button is the primary action and there is no choice being deferred.
		const gated = (this.opts.gateClosed ?? false) && !dismissCta;

		const footer = parent.createDiv({ cls: "engram-sync-preview-footer" });
		const dismissBtn = footer.createEl("button", {
			text: gated ? t("Not now") : dismissLabel,
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
			const changeBtn = footer.createEl("button", { text: t("Change vault") });
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
		summary.createSpan({ text: t("Advanced sync options") });
		const chevron = summary.createSpan({ cls: "engram-sync-preview-advanced-chevron" });
		setIcon(chevron, this.state.advancedOpen ? "chevron-down" : "chevron-right");

		// The native <details> owns open/close — just persist the state and swap
		// the chevron on toggle, no full re-render so the disclosure stays smooth.
		details.addEventListener("toggle", () => {
			this.state.advancedOpen = details.open;
			setIcon(chevron, details.open ? "chevron-down" : "chevron-right");
		});

		const grid = details.createDiv({ cls: "engram-sync-preview-options-grid" });
		for (const card of [...pushCards(), ...pullCards()]) {
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
			h.createSpan({ text: t("Everything is in sync") });
			return;
		}
		parent.createEl("h2", {
			text: headerFor(context),
			cls: "engram-sync-preview-header",
		});
	}

	private renderComparison(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "engram-sync-preview-compare" });
		const plan = this.requirePlan();

		this.renderCompareCard(wrap, {
			emoji: "💻",
			name: plan.vaultName,
			role: t("This vault"),
			notes: plan.localNoteCount,
			attachments: plan.localAttachmentCount,
			folders: plan.localFolderCount,
		});
		this.renderCompareCard(wrap, {
			emoji: "☁️",
			name: this.remoteVaultName || t("Cloud server"),
			role: t("Cloud server"),
			notes: plan.serverNoteCount,
			attachments: plan.serverAttachmentCount,
			folders: plan.serverFolderCount,
		});

		const match = computeMatchPercent(plan);
		const conflicts = plan.conflicts.length;
		const matchRow = parent.createDiv({ cls: "engram-sync-preview-match" });
		tInto(
			matchRow,
			"Your vault shares {percent} of its data with Engram",
			"percent",
			(row) => {
				const value = row.createSpan({
					cls: "engram-sync-preview-match-value",
					text: `${match}%`,
				});
				if (match === 100) value.addClass("is-perfect");
			},
			{ textCls: "engram-sync-preview-match-label" },
		);
		if (conflicts > 0) {
			const conflictRow = parent.createDiv({ cls: "engram-sync-preview-conflicts" });
			// {count} is a slot: the styled -value span prints it, and the count
			// still reaches t() to pick the plural form.
			tInto(
				conflictRow,
				"{count} conflicts need resolution",
				"count",
				(row) => {
					row.createSpan({
						cls: "engram-sync-preview-conflicts-value",
						text: `⚡ ${conflicts}`,
					});
				},
				{ vars: { count: conflicts }, textCls: "engram-sync-preview-conflicts-label" },
			);
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
		this.renderCompareRow(body, "📄", card.notes, t("notes"));
		this.renderCompareRow(body, "📎", card.attachments, t("attachments"));
		this.renderCompareRow(body, "📁", card.folders, t("folders"));
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
		btn.addEventListener("click", () => void this.pick(card.choice, btn));
	}

	/** The open-time quota lookup while it is in flight. */
	private quotaPending: Promise<void> | null = null;
	private closed = false;
	private picking = false;
	/** The option picked once the wait for the quota gave up; see onLateQuota. */
	private pickedPastCap: SyncChoice | null = null;

	/** The open-time quota answered after a pick stopped waiting for it. Over
	 *  the limit: while the delete confirm is still open, swap it for the
	 *  over-limit step; once the sync has started, tell the caller
	 *  (onLateOverLimit) so it can say so. */
	private onLateQuota(quota: NotesQuota): void {
		const choice = this.pickedPastCap;
		this.pickedPastCap = null;
		if (!choice || !uploadsNotes(choice)) return;
		if (this.state.addedBy(choice) <= quota.room) return;
		// Only a choice still in effect: not cancelled, not backed out of, not
		// swapped for another option, not from before a plan change.
		if (this.state.view === "confirm" && !this.closed && this.state.pendingChoice === choice) {
			this.state.goBack();
			this.state.pickOption(choice);
			this.render();
		} else if (this.state.view === "done" && this.resolvedChoice === choice) {
			this.opts.onLateOverLimit?.(quota);
		}
	}

	/** When the open-time quota answer arrived (0: not yet). */
	private quotaAnsweredAt = 0;

	/** QUOTA_WAIT_MS; a field so tests can shorten it. */
	private quotaWaitMs = QUOTA_WAIT_MS;

	/** Every option click goes through here: picking can resolve, or move to
	 *  the over-limit or confirm view, which only shows once re-rendered.
	 *  A null quota means "no step", so a pick made before the open-time lookup
	 *  answers waits for it, at most quotaWaitMs, with the clicked button
	 *  (`from`) shown busy. Past the cap it proceeds as an unknown quota, which
	 *  never blocks a sync. Other clicks are ignored while it waits. */
	private async pick(choice: SyncChoice, from?: HTMLButtonElement): Promise<void> {
		if (this.picking) return;
		// Only a pick that creates notes can hit the limit; nothing else waits.
		const canHitLimit = uploadsNotes(choice) && this.state.addedBy(choice) > 0;
		if (this.quotaPending && canHitLimit) {
			this.picking = true;
			if (from) {
				from.disabled = true;
				from.setAttribute("aria-busy", "true");
			}
			let answered = false;
			try {
				// Never throws: fetchNotesQuota does not, and a timeout is "proceed".
				await withTimeout(
					this.quotaPending.then(() => {
						answered = true;
					}),
					this.quotaWaitMs,
				).catch(() => undefined);
				// Still unanswered: proceeding as unknown, so a late answer is owed.
				if (!answered) this.pickedPastCap = choice;
			} finally {
				this.picking = false;
				if (from) {
					from.disabled = false;
					from.removeAttribute("aria-busy");
				}
			}
			if (this.closed) return;
		}
		this.state.pickOption(choice);
		const fresh = Date.now() - this.quotaAnsweredAt < QUOTA_FRESH_MS;
		if (this.state.view === "over-limit" && !fresh) void this.refreshOverLimitQuota();
		if (this.state.view !== "done") this.render();
	}

	private renderConfirm(): void {
		const { contentEl } = this;
		const choice = this.state.pendingChoice;
		if (choice == null) return;

		contentEl.createEl("h2", {
			text: t("Confirm destructive sync"),
			cls: "engram-sync-preview-header",
		});

		const summary = contentEl.createDiv({ cls: "engram-sync-preview-confirm-summary" });
		summary.createEl("p", { text: t("You are about to:") });
		const ul = summary.createEl("ul");
		for (const action of confirmActions(choice, this.requirePlan())) {
			ul.createEl("li", { text: action });
		}

		const deletePaths = this.deletePathsFor(choice);
		if (deletePaths.length > 0) {
			contentEl.createEl("p", {
				text: t("Files that will be deleted:"),
				cls: "engram-sync-preview-tree-caption",
			});
			this.renderDeletionTree(contentEl, deletePaths, this.keptPathsFor(choice, deletePaths));
		}

		contentEl.createEl("p", {
			cls: "engram-sync-preview-warning",
			text: t("This cannot be undone."),
		});
		const typeLine = contentEl.createEl("p");
		tInto(typeLine, "Type {keyword} to confirm:", "keyword", (line) => {
			line.createSpan({ text: CONFIRM_KEYWORD, cls: "engram-sync-preview-confirm-keyword" });
		});

		const input = contentEl.createEl("input", {
			type: "text",
			cls: "engram-sync-preview-confirm-input",
		});

		const footer = contentEl.createDiv({ cls: "engram-sync-preview-footer" });
		const backBtn = footer.createEl("button", { text: t("Back") });
		backBtn.addEventListener("click", () => {
			this.state.goBack();
			this.render();
		});

		const confirmBtn = footer.createEl("button", {
			text: t("Confirm"),
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

	/** This sync would add more notes than the plan has room left for. Say so
	 *  plainly, offer the upgrade, and let the user untick top-level folders to
	 *  fit or accept that the rest will not sync. Continue stays disabled until
	 *  one of those holds. */
	private renderOverLimit(): void {
		const { contentEl } = this;
		const quota = this.state.notesQuota;
		// Invariant: the step is only entered with a quota (needsOverLimitStep),
		// and only a verified-unlimited re-check clears it, which leaves the step.
		if (!quota) throw new Error("over-limit view rendered without a notes quota");
		const view = renderOverLimitView(contentEl, {
			count: this.state.addedBy(this.state.pendingChoice),
			quota,
			upgradeUrl: this.opts.upgradeUrl ?? null,
			// No picker for a choice that deletes on the server: ignoring a folder
			// there deletes its uploaded notes (see deletesRemote).
			middle: this.state.overLimitOffersPicker()
				? (el) => {
						new FolderPicker(el, {
							notePaths: this.state.localNotePaths(),
							newPaths: this.state.createdPaths(this.state.pendingChoice),
							excluded: this.state.overLimitExcluded,
							limit: quota.room,
							onChange: (excluded) => {
								this.state.setOverLimitExcluded(excluded);
								refresh();
							},
						});
						el.createEl("p", {
							text: t(
								"Unticked folders stop syncing, including notes already uploaded.",
							),
							cls: "engram-sync-preview-over-limit-hint",
						});
					}
				: undefined,
			error: this.state.overLimitError ?? "",
		});
		const { ackRow, ack, ackText, back: backBtn, cont: continueBtn } = view;
		const error = view.error as HTMLElement;
		ack.addEventListener("change", () => {
			this.state.toggleOverLimitAck();
			refresh();
		});
		backBtn.addEventListener("click", () => {
			this.state.goBack();
			this.render();
		});
		continueBtn.addEventListener("click", () => {
			void this.continueOverLimit(refresh, error);
		});

		const refresh = () => {
			const over = this.state.overLimitOver();
			ackRow.hidden = over === 0;
			ack.checked = this.state.overLimitAck;
			ackText.setText(t("I understand {count} notes will not sync.", { count: over }));
			backBtn.disabled = this.state.overLimitSaving;
			continueBtn.disabled = !this.state.canContinueOverLimit();
		};
		refresh();
	}

	private async continueOverLimit(refresh: () => void, error: HTMLElement): Promise<void> {
		if (!this.state.canContinueOverLimit()) return;
		const folders = this.state.overLimitOffersPicker()
			? this.state.overLimitExcluded.filter((f) => f !== ROOT_FOLDER)
			: [];
		let plan: SyncPlan | null = null;
		if (folders.length > 0) {
			this.state.beginOverLimitSave();
			refresh();
			const saving = new AbortController();
			this.saving = saving;
			try {
				await this.opts.applyExclusions(folders, saving.signal);
				const held = this.state.plan;
				plan = held && planWithoutFolders(held, folders);
			} catch (e: unknown) {
				if (saving.signal.aborted) return; // closed mid-save; nothing to show
				devLog().log("error", `saving over-limit exclusions failed: ${errMsg(e)}`);
				this.state.endOverLimitSave(t("Could not save your folder choice. Try again."));
				error.setText(this.state.overLimitError ?? "");
				refresh();
				return;
			} finally {
				this.saving = null;
			}
		}
		this.state.finishOverLimit(plan);
		this.render();
	}

	private renderVaultPicker(): void {
		if (this.state.creatingVault) {
			this.renderCreateVaultForm();
			return;
		}

		const { contentEl } = this;
		contentEl.createEl("h2", {
			text: t("Switch vault"),
			cls: "engram-sync-preview-header",
		});
		contentEl.createEl("p", {
			text: t(
				"Pick a vault to sync with. We will recalculate the sync preview after you choose.",
			),
			cls: "engram-sync-preview-picker-help",
		});

		const body = contentEl.createDiv({ cls: "engram-sync-preview-picker-body" });

		if (this.state.vaultsLoading) {
			body.createEl("p", { text: t("Loading vaults…") });
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
						text: t(" (default)"),
						cls: "engram-sync-preview-picker-item-default",
					});
				}
				item.addEventListener("click", () => {
					void this.applyPickedVault(v);
				});
			}
		} else {
			body.createEl("p", { text: t("No other vaults available.") });
		}

		const footer = contentEl.createDiv({ cls: "engram-sync-preview-footer" });
		const backBtn = footer.createEl("button", { text: t("Back") });
		backBtn.addEventListener("click", () => {
			this.state.exitVaultPicker();
			this.render();
		});

		if (this.opts.createVault) {
			const newBtn = footer.createEl("button", {
				text: t("Make new vault"),
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
			text: t("New vault"),
			cls: "engram-sync-preview-header",
		});
		contentEl.createEl("p", {
			text: t(
				"Create a new empty vault on the server, then sync this Obsidian vault into it.",
			),
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
		input.placeholder = t("Vault name");

		const footer = contentEl.createDiv({ cls: "engram-sync-preview-footer" });
		const backBtn = footer.createEl("button", { text: t("Back") });
		backBtn.addEventListener("click", () => {
			this.state.exitCreateVault();
			this.render();
		});

		const createBtn = footer.createEl("button", {
			text: t("Create"),
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
			devLog().log("error", `listVaults failed: ${errMsg(e)}`);
			const msg = t("Could not load vaults: {error}", { error: userErrorMessage(e) });
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
			this.state.onVaultsError(t("Enter a name for the new vault"));
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
			this.pickedPastCap = null; // a pick made for the old plan
			this.remoteVaultName = v.name;
			this.state.exitVaultPicker();
		} catch (e: unknown) {
			devLog().log("error", `vault switch failed: ${errMsg(e)}`);
			const msg = t("Failed to switch vault: {error}", { error: userErrorMessage(e) });
			this.state.onVaultsError(msg);
		}
		this.render();
	}
}

/** The over-limit step's markup: heading, plan size, Upgrade, an optional
 *  middle (the folder picker), the acknowledgement row, an optional error
 *  line, and Back / Continue. The caller wires the behaviour. */
function renderOverLimitView(
	el: HTMLElement,
	opts: {
		count: number;
		quota: NotesQuota;
		upgradeUrl: string | null;
		middle?: (el: HTMLElement) => void;
		error?: string;
	},
): {
	ackRow: HTMLElement;
	ack: HTMLInputElement;
	ackText: HTMLElement;
	error: HTMLElement | null;
	back: HTMLButtonElement;
	cont: HTMLButtonElement;
} {
	const { count, quota, upgradeUrl } = opts;
	el.createEl("h2", {
		text: overLimitHeading(count, quota.room),
		cls: "engram-sync-preview-header",
	});
	el.createEl("p", {
		text: t("Your plan syncs {count} notes.", { count: quota.limit }),
	});
	if (upgradeUrl) {
		const upgrade = el.createEl("button", { text: t("Upgrade"), cls: "mod-cta" });
		upgrade.addEventListener("click", () => window.open(upgradeUrl, "_blank"));
	}
	opts.middle?.(el);
	const ackRow = el.createEl("label", { cls: "engram-sync-preview-over-limit-ack" });
	const ack = ackRow.createEl("input", { type: "checkbox" });
	const ackText = ackRow.createSpan();
	const error =
		opts.error === undefined
			? null
			: el.createEl("p", { cls: "engram-sync-preview-picker-error", text: opts.error });
	const footer = el.createEl("footer", { cls: "engram-sync-preview-footer" });
	const back = footer.createEl("button", { text: t("Back") });
	const cont = footer.createEl("button", { text: t("Continue") });
	return { ackRow, ack, ackText, error, back, cont };
}

/** A "Sync again" plan's actions, counted for the confirm. */
export function countFolderPlan(plan: FolderPlan): FolderPlanCounts {
	const of = (kind: FolderAction["kind"]) => plan.actions.filter((a) => a.kind === kind).length;
	return {
		upload: of("upload"),
		download: of("download"),
		deleteOnServer: of("deleteOnServer"),
		conflicts: of("conflict"),
		newNotes: plan.actions.filter((a) => a.creates).length,
	};
}

/** What a "Sync again" plan will do, in numbers. */
export interface FolderPlanCounts {
	upload: number;
	download: number;
	deleteOnServer: number;
	conflicts: number;
	/** Uploads that add a new note on the server: what the plan limit counts. */
	newNotes: number;
}

/** The one confirm for "Sync again": the folder, what the plan will do, and,
 *  when its new notes do not fit the room left on the plan, the over-limit
 *  step's message and acknowledgement (no folder picker: it is one folder).
 *  Resolves true on Continue, false on Cancel / Back / close. */
export class SyncAgainModal extends Modal {
	private answer: ((ok: boolean) => void) | null = null;

	constructor(
		app: App,
		private readonly folder: string,
		private readonly counts: FolderPlanCounts,
		/** Known quota, or null (self-host, unknown, unlimited): no step. */
		private readonly quota: NotesQuota | null,
		private readonly upgradeUrl: string | null,
	) {
		super(app);
	}

	awaitAnswer(): Promise<boolean> {
		return new Promise((resolve) => {
			this.answer = resolve;
			this.open();
		});
	}

	/** True when the plan's new notes do not fit the room left. */
	overLimit(): boolean {
		return this.quota !== null && this.counts.newNotes > this.quota.room;
	}

	onOpen(): void {
		const { contentEl, counts, quota } = this;
		contentEl.addClass("engram-sync-preview-modal");
		const summary = (el: HTMLElement) => {
			el.createEl("p", { text: asIs(this.folder), cls: "engram-sync-preview-folder" });
			const lines: string[] = [];
			if (counts.upload)
				lines.push(t("Will upload {count} files.", { count: counts.upload }));
			if (counts.download)
				lines.push(t("Will download {count} files.", { count: counts.download }));
			if (counts.deleteOnServer)
				lines.push(
					t("Will delete {count} files on the server.", { count: counts.deleteOnServer }),
				);
			if (counts.conflicts)
				lines.push(t("{count} conflicts to resolve.", { count: counts.conflicts }));
			if (lines.length === 0) lines.push(t("Already in sync. Nothing is deleted."));
			const list = el.createEl("ul", { cls: "engram-sync-again-summary" });
			for (const line of lines) list.createEl("li", { text: line });
		};

		let back: HTMLButtonElement;
		let cont: HTMLButtonElement;
		if (quota && this.overLimit()) {
			const view = renderOverLimitView(contentEl, {
				count: counts.newNotes,
				quota,
				upgradeUrl: this.upgradeUrl,
				middle: summary,
			});
			view.ackText.setText(
				t("I understand {count} notes will not sync.", {
					count: counts.newNotes - quota.room,
				}),
			);
			({ back, cont } = view);
			cont.disabled = true;
			view.ack.addEventListener("change", () => {
				cont.disabled = !view.ack.checked;
			});
		} else {
			contentEl.createEl("h2", { text: t("Sync again"), cls: "engram-sync-preview-header" });
			summary(contentEl);
			const footer = contentEl.createEl("footer", { cls: "engram-sync-preview-footer" });
			back = footer.createEl("button", { text: t("Cancel") });
			cont = footer.createEl("button", { text: t("Continue"), cls: "mod-cta" });
		}
		back.addEventListener("click", () => this.finish(false));
		cont.addEventListener("click", () => {
			if (!cont.disabled) this.finish(true);
		});
	}

	private finish(ok: boolean): void {
		this.settle(ok);
		this.close();
	}

	private settle(ok: boolean): void {
		const answer = this.answer;
		this.answer = null;
		answer?.(ok);
	}

	/** Esc / backdrop declines (a no-op once Cancel or Continue settled it). */
	onClose(): void {
		this.contentEl.empty();
		this.settle(false);
	}
}

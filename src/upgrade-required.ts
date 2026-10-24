/**
 * upgrade-required.ts — the client half of the backend's minimum-plugin-version
 * floor.
 *
 * The server refuses a plugin older than its floor: HTTP `426` on REST, and a
 * `plugin_upgrade_required` reason on a channel join. Both are terminal —
 * retrying cannot clear them and every transport is refused at once — so the
 * user has to be told, or they watch sync fail forever with no explanation.
 *
 * ## Why the server's `update_url` is ignored
 *
 * The 426 body carries one, and this module deliberately does not read it.
 * `api.ts`'s `sanitizeUpgradeUrl` already refuses any non-http(s) URL from a
 * 402 body precisely because a malicious self-host backend must not be able to
 * launch arbitrary protocol handlers — and the natural update target here IS a
 * non-http scheme (`obsidian://`). Rather than carve an exception into that
 * rule, the action is supplied locally by `main.ts` via `setUpgradeAction`.
 * The server field stays useful to other clients; this one never trusts it.
 *
 * ## Once per session, but the blocked state stays on screen
 *
 * Every refused request and every reconnect would otherwise toast, so the
 * Notice fires once per session. The Notice alone was not enough: a user on
 * 1.35.0 synced nothing for two days after it faded. So the refusal also
 * drives a persistent "update required" status bar item and a Sync Center
 * banner, repainted through `setUpgradeStateListener`.
 *
 * The blocked state has exactly three clearing events:
 *  1. Plugin reload (including the reload Obsidian does after an update): the
 *     module graph is re-evaluated, so every latch here starts fresh.
 *  2. Backend change (`clearUpgradeRefusal`, from `EngramApi.updateConfig`):
 *     a different server has its own floor. Re-arms the Notice too.
 *  3. Server admits us (`markAdmitted`, from a successful `sync:` join): the
 *     floor no longer refuses this version. Does NOT re-arm the Notice, so a
 *     fleet mid-rollout with mixed floors cannot toast on every flip. A
 *     refused client never rejoins by itself (see "Refused means refused
 *     locally too" below), so a server that LOWERS its floor is only noticed
 *     on the next socket reconnect (network drop, backend restart) or reload.
 *
 * While refused, the offline queue holds untouched (sync.ts runFlushQueue)
 * and per-file 426 issues are not recorded (issue-store.ts), so nothing the
 * user changed is dropped. main.ts drains the queue on clearing event 3; a
 * reload or backend switch drains through the normal startup / sync-gate path.
 *
 * ## Refused means refused locally too
 *
 * Once latched, `EngramApi.request` throws `upgradeRequiredError()` without
 * touching the network, and the trace beacon drops its batches. Nothing
 * retries: the remote logger re-buffers a failed batch and flushes on a
 * timer, so a per-request 426 turned into an endless POST /api/logs loop.
 *
 * The socket is left alone: Phoenix does not close a socket on a join error,
 * so a refused client keeps ONE open socket. `sync:` and `crdt:` are refused,
 * `user:` still joins (no version gate on `check_not_deleted/1`), and the 30s
 * heartbeat keeps it alive, so `onclose` never fires and the client idles
 * with `connected === false` rather than retry-storming.
 */
import { Notice } from "obsidian";
import { t } from "./i18n";
import { rlog } from "./remote-log";

const NOTICE_MS = 15_000;

let notified = false;
// Separate from `notified`: a bare 426 (a proxy) still warns, but only the
// server's own floor refusal stops requests. Updating cannot fix a proxy.
let refused = false;
let openUpdateUi: (() => void) | null = null;
let refusedMinVersion: string | null = null;
/** `admitted` = cleared by the server accepting a `sync:` join (event 3),
 *  the only clear where draining the held queue is safe: a backend switch
 *  (event 2) lands mid-reconfigure, before the new auth exists, and drains
 *  through the sync gate on its own. */
type UpgradeStateListener = (admitted: boolean) => void;
let onStateChange: UpgradeStateListener | null = null;

/** Repaint hook for the persistent UI (status bar + Sync Center). Called on
 *  every change of `isUpgradeRequired()`, never on a no-op. One slot: `main.ts`
 *  is the only subscriber, and clears it on unload like `setUpgradeAction`. */
export function setUpgradeStateListener(fn: UpgradeStateListener | null): void {
	onStateChange = fn;
}

function setRefused(next: boolean, minVersion: string | null = null, admitted = false): void {
	if (next) refusedMinVersion = minVersion ?? refusedMinVersion;
	else refusedMinVersion = null;
	if (refused === next) return;
	refused = next;
	onStateChange?.(admitted);
}

/** Whether an update action is wired, so a caller can skip a dead button. */
export function canOpenUpgradeUi(): boolean {
	return openUpdateUi !== null;
}

/** Open the update UI if one is wired. False when unset (tests, unload). */
export function openUpgradeUi(): boolean {
	if (!openUpdateUi) return false;
	openUpdateUi();
	return true;
}

/**
 * Supply the "take me there" action. `main.ts` passes its
 * `openCommunityPluginsUpdate`, which opens Obsidian's Community plugins tab
 * and refreshes its update check — the same path the soft update nudge uses,
 * already feature-detected against Obsidian internals.
 *
 * Unset (tests, or a load order that never got here) degrades to a Notice with
 * no link, never a throw.
 */
export function setUpgradeAction(fn: (() => void) | null): void {
	openUpdateUi = fn;
}

/** Where the refusal came from. Folded into the single latched log line so a
 *  false positive is diagnosable — 426 is a generic HTTP status and a proxy in
 *  front of a self-hosted backend can emit a bare one, leaving the user with
 *  "this plugin is too old" that updating cannot fix. Omitted for a socket
 *  refusal, which `channel.ts` logs separately with its own topic. */
export interface UpgradeRefusalSource {
	method: string;
	route: string;
}

/** Tell the user their plugin is too old. First call wins; the rest are no-ops.
 *  `confirmed` = the server's own floor said so (`plugin_upgrade_required`),
 *  which is what latches the local refusal. */
export function notifyUpgradeRequired(
	minVersion: string | null,
	source?: UpgradeRefusalSource,
	confirmed = true,
): void {
	if (confirmed) setRefused(true, minVersion);
	if (notified) return;
	notified = true;

	const where = source ? ` on ${source.method} ${source.route}` : "";
	rlog().warn(
		"lifecycle",
		`server requires plugin >= ${minVersion ?? "unknown"}${where} — sync refused until updated`,
	);

	// Two whole sentences rather than one with an appended fragment: a clause
	// spliced onto a translated sentence cannot be reordered by the translator.
	const message = minVersion
		? t(
				"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.",
				{
					version: minVersion,
				},
			)
		: t("Engram: this plugin is too old to sync. Update it to continue.");
	const notice = new Notice(message, NOTICE_MS);

	// No action wired = no button. A button that does nothing is worse than
	// prose telling the user to go update.
	if (!openUpdateUi) return;
	const noticeEl = (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
	if (!noticeEl) return;
	// "Update", never "Upgrade" — the 402 toast next door uses "Upgrade" for
	// paying more money, and these two must not read as the same action.
	const btn = noticeEl.createEl("button", {
		text: t("Update"),
		cls: "engram-limit-upgrade-btn",
	});
	btn.addEventListener("click", () => openUpgradeUi());
}

/** True once the server has refused us for being too old. */
export function isUpgradeRequired(): boolean {
	return refused;
}

/** The minimum version the server's floor named, or null if not refused (or
 *  the refusal carried none). */
export function upgradeRequiredMinVersion(): string | null {
	return refused ? refusedMinVersion : null;
}

/** Clearing event 2: a different server has its own floor (or none). Stop
 *  refusing locally, and re-arm the notice so that server's own refusal is not
 *  swallowed. */
export function clearUpgradeRefusal(): void {
	setRefused(false);
	notified = false;
}

/** Clearing event 3: the server admitted a `sync:` join, so its floor accepts
 *  this version. The notice stays latched (see module doc). */
export function markAdmitted(): void {
	setRefused(false, null, true);
}

/** What `EngramApi` throws in place of a request once refused. Carries
 *  `status: 426` so every caller's existing status routing treats it exactly
 *  like the server's own refusal. */
export function upgradeRequiredError(): Error & { status: 426 } {
	return Object.assign(new Error("plugin_upgrade_required (refused locally)"), {
		status: 426 as const,
	});
}

/** Test seam. The latch is otherwise per-process by design. */
export function resetUpgradeRequired(): void {
	notified = false;
	refused = false;
	refusedMinVersion = null;
	openUpdateUi = null;
	onStateChange = null;
}

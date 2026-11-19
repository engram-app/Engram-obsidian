/**
 * upgrade-required.ts — the client half of the backend's refusal of a client:
 * the minimum-plugin-version floor (`update_required`) and a paused account
 * (`account_paused`). Both arrive as the same 426 / join-refusal shape, share
 * ONE latch, and differ only in copy (an update fixes the first, support the
 * second).
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
 * The blocked state has these clearing events (4-7 are the self-recheck below):
 *  1. Plugin reload: the module graph is re-evaluated and every latch starts
 *     fresh, then `restoreRefusal` re-latches from data.json (event 6).
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
 * user changed is dropped. main.ts drains the queue on clearing event 3; after
 * a reload or backend switch the drain comes from the `crdt:` join kick in
 * main.ts (onCrdtTopicJoined), like any other reconnect.
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
import { pluginVersion } from "./plugin-version";
import { rlog } from "./remote-log";
import { SUPPORT_EMAIL } from "./tabs/urls";
import type { TimeProvider } from "./time-provider";
import { isNewerVersion } from "./update-check";

const NOTICE_MS = 15_000;

/** Which refusal kind the Notice last fired for. A different kind re-notifies
 *  (an account pause landing after an update refusal is new information). */
let notifiedKind: RefusalKind | null = null;
// Separate from `notifiedKind`: a bare 426 (a proxy) still warns, but only the
// server's own floor refusal stops requests. Updating cannot fix a proxy.
let refused = false;
let openUpdateUi: (() => void) | null = null;
let refusedMinVersion: string | null = null;
let refusedKind: RefusalKind = "update_required";
let refusedRetryAfterS: number | null = null;
let refusedUpdateTo: string | null = null;
/** `admitted` = cleared by the server accepting a `sync:` join (event 3),
 *  the only clear where draining the held queue is safe: a backend switch
 *  (event 2) lands mid-reconfigure, before the new auth exists, and drains
 *  later from the new channel's `crdt:` join kick. */
type UpgradeStateListener = (admitted: boolean, rejoin: boolean) => void;
let onStateChange: UpgradeStateListener | null = null;

/** Repaint hook for the persistent UI (status bar + Sync Center). Called on
 *  every change of `isUpgradeRequired()`, never on a no-op. One slot: `main.ts`
 *  is the only subscriber, and clears it on unload like `setUpgradeAction`. */
export function setUpgradeStateListener(fn: UpgradeStateListener | null): void {
	onStateChange = fn;
}

function setRefused(
	next: boolean,
	minVersion: string | null = null,
	admitted = false,
	rejoin = false,
	{ kind = "update_required", retryAfterS = null, updateTo = null }: RefusalOpts = {},
): void {
	const kindChanged = next && refused && refusedKind !== kind;
	if (next) {
		refusedMinVersion = minVersion ?? refusedMinVersion;
		refusedKind = kind;
		refusedRetryAfterS = retryAfterS ?? refusedRetryAfterS;
		refusedUpdateTo = updateTo ?? refusedUpdateTo;
	} else {
		refusedMinVersion = null;
		refusedKind = "update_required";
		refusedRetryAfterS = null;
		refusedUpdateTo = null;
	}
	const changed = refused !== next || kindChanged;
	refused = next;
	if (next) scheduleRecheck();
	else cancelRecheck();
	if (changed) onStateChange?.(admitted, rejoin);
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

/** Whether a recheck is wired, so a caller can skip a dead button (tests,
 *  unload). */
export function canRecheck(): boolean {
	return recheck !== null;
}

function addCheckAgainButton(notice: Notice): void {
	if (!canRecheck()) return;
	const noticeEl = (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
	if (!noticeEl) return;
	const btn = noticeEl.createEl("button", { text: t("Check again") });
	btn.addEventListener("click", () => void checkAgainWithFeedback());
}

export type RefusalKind = "update_required" | "account_paused";
interface RefusalOpts {
	kind?: RefusalKind;
	retryAfterS?: number | null;
	/** The version the server says to update to (falls back to min_version). */
	updateTo?: string | null;
}

const VERSION_RE = /^v?\d+(\.\d+){1,3}$/;

/** THE version compare: true only when BOTH strings are well-formed versions
 *  and `min` is strictly above `current`. A garbage or empty string on either
 *  side is "unknown", never a block (isNewerVersion alone reads garbage as
 *  0.0.0, which would block an unset local version). */
export function versionBelow(min: unknown, current: unknown): boolean {
	if (typeof min !== "string" || typeof current !== "string") return false;
	if (!VERSION_RE.test(min.trim()) || !VERSION_RE.test(current.trim())) return false;
	return isNewerVersion(min.trim().replace(/^v/, ""), current.trim().replace(/^v/, ""));
}

/** The version to tell the user to update to. */
export function refusalTargetVersion(): string | null {
	return refused ? (refusedUpdateTo ?? refusedMinVersion) : null;
}

/** The copy sentence naming both versions, or null when either is unknown
 *  (callers fall back to the version-less wording). */
export function versionsCopy(): string | null {
	const target = refusalTargetVersion();
	const current = pluginVersion();
	if (!target || !VERSION_RE.test(current)) return null;
	return t("You have {current}. Update to {target} or newer to keep syncing.", {
		current,
		target,
	});
}

/** What a refusal body (REST 426 JSON, or a channel join `response`) says.
 *  The ONE parser both transports use, structured fields only: a generic
 *  error, timeout or 5xx has no recognised `error`/`reason`, so it is never
 *  `confirmed` and never latches. Backend contract (Engram#2672): the floor is
 *  HTTP 426 `{error: "plugin_upgrade_required", min_version, update_to,
 *  your_version}`; a paused account is HTTP 403 `{error: "account_paused"}`;
 *  both carry a `retry-after: 3600` header. A join refusal carries the same
 *  code in `reason`. Status gating (403 only counts as `account_paused`) lives
 *  in `EngramApi.noteIfUpgradeRequired`. */
export function parseRefusal(body: Record<string, unknown> | undefined): {
	confirmed: boolean;
	kind: RefusalKind;
	minVersion: string | null;
	updateTo: string | null;
	retryAfterS: number | null;
} {
	const b = body ?? {};
	const codes = [b.error, b.reason];
	const paused = codes.includes("account_paused");
	const confirmed =
		paused || codes.includes("plugin_upgrade_required") || codes.includes("update_required");
	const ra = b.retry_after;
	return {
		confirmed,
		kind: paused ? "account_paused" : "update_required",
		minVersion: typeof b.min_version === "string" ? b.min_version : null,
		updateTo: typeof b.update_to === "string" ? b.update_to : null,
		retryAfterS: typeof ra === "number" && Number.isFinite(ra) && ra > 0 ? ra : null,
	};
}

/** Tell the user sync is refused. First call per kind wins; the rest are
 *  no-ops. `confirmed` = the server's own refusal said so, which is what
 *  latches the local refusal. */
export function notifyUpgradeRequired(
	minVersion: string | null,
	source?: UpgradeRefusalSource,
	confirmed = true,
	{ kind = "update_required", retryAfterS = null, updateTo = null }: RefusalOpts = {},
): void {
	if (confirmed) setRefused(true, minVersion, false, false, { kind, retryAfterS, updateTo });
	if (notifiedKind === kind) return;
	notifiedKind = kind;

	const where = source ? ` on ${source.method} ${source.route}` : "";
	if (kind === "account_paused") {
		rlog().warn("lifecycle", `account paused by server${where} — sync refused until lifted`);
		// Support, not Update: the user cannot fix this by updating.
		const paused = new Notice(
			t(
				"Engram: this account is paused, so syncing is off. Your changes stay on this device. Contact {email} to get it restored.",
				{ email: SUPPORT_EMAIL },
			),
			NOTICE_MS,
		);
		addCheckAgainButton(paused);
		return;
	}
	rlog().warn(
		"lifecycle",
		`server requires plugin >= ${minVersion ?? "unknown"}${where} — sync refused until updated`,
	);

	// Two whole sentences rather than one with an appended fragment: a clause
	// spliced onto a translated sentence cannot be reordered by the translator.
	const both = versionsCopy();
	const message = both
		? t("Engram: this plugin is too old to sync. {versions}", { versions: both })
		: minVersion
			? t(
					"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.",
					{
						version: minVersion,
					},
				)
			: t("Engram: this plugin is too old to sync. Update it to continue.");
	const notice = new Notice(message, NOTICE_MS);

	addCheckAgainButton(notice);
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

/** One-call "Check again" for every button: probe now and tell the user what
 *  happened, so a click is never silent. */
export async function checkAgainWithFeedback(): Promise<void> {
	const r = await recheckNow();
	const msg =
		r === "clear"
			? t("Engram: the server accepts this device again. Sync is resuming.")
			: r === "refused"
				? t("Engram: still refused by the server. We will keep checking automatically.")
				: r === "throttled"
					? t("Engram: checked a moment ago. Try again in a few seconds.")
					: t("Engram: could not reach the server. We will keep checking automatically.");
	new Notice(msg);
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
	notifiedKind = null;
}

/** Which kind of refusal is latched, or null when not refused. */
export function refusalKind(): RefusalKind | null {
	return refused ? refusedKind : null;
}

/** Result of one recheck probe. `unknown` = 5xx, timeout, 401, offline:
 *  nothing learned, so the refusal stays and the next probe backs off. */
export type RefusalProbe = "clear" | "refused" | "unknown";

const RECHECK_BASE_MS = 3_600_000;
const RECHECK_MIN_MS = 600_000;
const RECHECK_MAX_MS = 4 * 3_600_000;
const RECHECK_RESTORE_MS = 15_000;
/** Minimum gap between user-pressed "Check again" probes. */
const MANUAL_COOLDOWN_MS = 30_000;

interface RecheckDeps {
	time: TimeProvider;
	probe: () => Promise<RefusalProbe>;
	/** Jitter source; tests pass a constant. */
	random?: () => number;
}
let recheck: RecheckDeps | null = null;
let recheckTimer: number | null = null;
let recheckInFlight = false;
let recheckFailures = 0;
let lastManualAt = Number.NEGATIVE_INFINITY;

/** Arm the self-recheck (main.ts onload). Until armed, nothing is scheduled. */
export function startRefusalRecheck(deps: RecheckDeps): void {
	stopRefusalRecheck();
	recheck = deps;
	if (refused) scheduleRecheck();
}

/** Clearing event: unload. Also called by every other clear via setRefused. */
export function stopRefusalRecheck(): void {
	cancelRecheck();
	recheck = null;
}

function clearRecheckTimer(): void {
	if (recheck && recheckTimer !== null) recheck.time.clearTimeout(recheckTimer);
	recheckTimer = null;
}

function cancelRecheck(): void {
	clearRecheckTimer();
	recheckFailures = 0;
}

/** One timer, one probe in flight, never sooner than 10 min: a refused device
 *  sends about one cheap GET an hour (up from zero), never a storm. The delay
 *  is the server's `retry_after` when it gave one (clamped), +/-10% jitter so
 *  a fleet refused by one deploy does not probe in lockstep, doubling on each
 *  probe that learned nothing. */
function scheduleRecheck(firstDelayMs?: number): void {
	if (!recheck || recheckTimer !== null || recheckInFlight) return;
	const { time, random = Math.random } = recheck;
	const base = Math.min(
		Math.max((refusedRetryAfterS ?? RECHECK_BASE_MS / 1000) * 1000, RECHECK_MIN_MS),
		RECHECK_BASE_MS * 2,
	);
	const delay =
		firstDelayMs ??
		Math.min(base * 2 ** recheckFailures * (0.9 + 0.2 * random()), RECHECK_MAX_MS);
	recheckTimer = time.setTimeout(() => {
		recheckTimer = null;
		void runRecheck();
	}, delay);
}

/** "Check again now" (Notice / Sync Center button). Probes immediately, at
 *  most once per 30 s, and shares the in-flight guard with the timer so a
 *  button mash sends one request. `throttled` = ignored, nothing sent. */
export async function recheckNow(): Promise<RefusalProbe | "throttled"> {
	if (!recheck || !refused) return "unknown";
	const now = recheck.time.now();
	if (recheckInFlight || now - lastManualAt < MANUAL_COOLDOWN_MS) return "throttled";
	lastManualAt = now;
	clearRecheckTimer();
	return runRecheck();
}

async function runRecheck(): Promise<RefusalProbe> {
	const deps = recheck;
	if (!deps || !refused || recheckInFlight) return "unknown";
	recheckInFlight = true;
	let result: RefusalProbe = "unknown";
	try {
		result = await deps.probe();
	} catch {
		// A probe must never throw out of a timer; treat as "learned nothing".
	} finally {
		recheckInFlight = false;
	}
	if (recheck !== deps || !refused) return result; // unloaded or cleared meanwhile
	if (result === "clear") {
		rlog().info("lifecycle", "refusal lifted by recheck — resuming sync");
		// rejoin: a refused socket never rejoins by itself, so resume must.
		markAdmitted(true);
		return result;
	}
	recheckFailures = result === "unknown" ? recheckFailures + 1 : 0;
	scheduleRecheck();
	return result;
}

/** Clearing event 3: the server admitted a `sync:` join, so its floor accepts
 *  this version. The notice stays latched (see module doc). */
export function markAdmitted(rejoin = false): void {
	setRefused(false, null, true, rejoin);
}

/** What survives a restart so a refusal does not silently vanish (and a
 *  paused/too-old device does not spend a session failing before it learns). */
export interface PersistedRefusal {
	kind: RefusalKind;
	minVersion: string | null;
	updateTo?: string | null;
	retryAfterS: number | null;
}

export function persistedRefusal(): PersistedRefusal | null {
	return refused
		? {
				kind: refusedKind,
				minVersion: refusedMinVersion,
				updateTo: refusedUpdateTo,
				retryAfterS: refusedRetryAfterS,
			}
		: null;
}

/** Clearing event: version change. Re-latch a refusal saved by the last
 *  session, unless this build is already at or above the version the server
 *  said it needed (the user updated: no server round trip to learn that).
 *  Quiet: no Notice and no listener call; the persistent status bar / banner
 *  carry it, and the first recheck runs after `RECHECK_RESTORE_MS`.
 *  Returns whether it re-latched. */
export function restoreRefusal(
	saved: PersistedRefusal | null | undefined,
	currentVersion: string,
): boolean {
	if (!saved || (saved.kind !== "update_required" && saved.kind !== "account_paused"))
		return false;
	if (
		saved.kind === "update_required" &&
		saved.minVersion &&
		!isNewerVersion(saved.minVersion, currentVersion)
	)
		return false;
	refused = true;
	refusedKind = saved.kind;
	refusedMinVersion = saved.minVersion;
	refusedRetryAfterS = saved.retryAfterS;
	refusedUpdateTo = saved.updateTo ?? null;
	notifiedKind = saved.kind;
	scheduleRecheck(RECHECK_RESTORE_MS);
	return true;
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
	notifiedKind = null;
	refused = false;
	refusedMinVersion = null;
	refusedKind = "update_required";
	refusedRetryAfterS = null;
	refusedUpdateTo = null;
	stopRefusalRecheck();
	lastManualAt = Number.NEGATIVE_INFINITY;
	openUpdateUi = null;
	onStateChange = null;
}

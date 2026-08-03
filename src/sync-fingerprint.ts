import { sha256Hex } from "./content-hash";
import type { EngramSyncSettings } from "./types";

/** Identity of the live WebSocket/channel connection: which backend, which
 *  account, which vault. `setupNoteStream()` rebuilds the socket + CRDT stack
 *  only when this key changes, so an unrelated `saveSettings()` no longer tears
 *  down a healthy connection (the reconnect-churn that starved CRDT delivery).
 *
 *  Mirrors `computeSyncFingerprint`'s account-not-credential rule: OAuth refresh
 *  tokens rotate on every refresh, so key on the stable userEmail — NOT the
 *  token — or every token refresh would needlessly rebuild the socket. Plain
 *  string (no hashing): compared in-memory, never persisted. */
export function channelConnectionKey(settings: EngramSyncSettings): string {
	const authPart = settings.refreshToken ? settings.userEmail || "" : settings.apiKey || "";
	return `${settings.apiUrl || ""}|${authPart}|${settings.vaultId || ""}`;
}

/** Fingerprint identifying the current auth + vault combination. Used to
 *  decide whether the SyncPreviewModal must fire. Order matters — keep it
 *  stable across releases or the gate will incorrectly re-fire for everyone. */
export async function computeSyncFingerprint(settings: EngramSyncSettings): Promise<string> {
	// Identify the account, NOT the credential. OAuth refresh tokens are
	// single-use and rotate on every refresh, so keying on the token would
	// change the fingerprint each refresh and slam the sync gate shut
	// (fullSync/WS then silently no-op). Use the stable userEmail for OAuth;
	// fall back to the (static) apiKey for self-hosted / api-key auth.
	const authPart = settings.refreshToken ? settings.userEmail || "" : settings.apiKey || "";
	const vaultPart = settings.vaultId || "";
	const input = `${authPart}|${vaultPart}`;
	if (input === "|") return ""; // Both empty = no fingerprint yet
	return sha256Hex(input);
}

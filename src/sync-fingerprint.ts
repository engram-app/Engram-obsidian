import type { EngramSyncSettings } from "./types";

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
	const encoder = new TextEncoder();
	const data = encoder.encode(input);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

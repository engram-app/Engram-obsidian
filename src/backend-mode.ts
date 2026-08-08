import {
	BACKEND_SCOPED_FIELDS,
	type BackendMode,
	type BackendSlot,
	type EngramSyncSettings,
} from "./types";

/** Read the active backend's fields into a standalone slot. */
export function captureSlot(settings: EngramSyncSettings): BackendSlot {
	const slot = {} as Record<string, unknown>;
	for (const key of BACKEND_SCOPED_FIELDS) {
		slot[key] = settings[key];
	}
	return slot as BackendSlot;
}

/** Write a slot back onto settings IN PLACE. In-place is required, not
 *  stylistic: SyncEngine and the API client hold a reference to this object,
 *  so replacing it would leave them reading a stale backend. Same discipline
 *  as applyApiUrlChange. */
export function applySlot(settings: EngramSyncSettings, slot: BackendSlot): void {
	const target = settings as unknown as Record<string, unknown>;
	for (const key of BACKEND_SCOPED_FIELDS) {
		target[key] = slot[key];
	}
}

export type ConnectionState = "connected" | "needs-url" | "needs-auth";

/** What, if anything, the active backend is still missing. Read by BOTH the
 *  Connection tab banner and the sync guard, so the two cannot disagree about
 *  whether the plugin is usable. */
export function connectionState(
	settings: Pick<EngramSyncSettings, "apiUrl" | "apiKey" | "refreshToken">,
): ConnectionState {
	if (!settings.apiUrl) return "needs-url";
	if (!settings.apiKey && !settings.refreshToken) return "needs-auth";
	return "connected";
}

/** A backend that has never been configured. */
function emptySlot(apiUrl: string): BackendSlot {
	return {
		apiUrl,
		apiKey: "",
		refreshToken: undefined,
		userEmail: undefined,
		authMethod: null,
		vaultId: null,
		remoteVaultName: undefined,
		accessToken: undefined,
		accessTokenExpiresAt: undefined,
		accessTokenVaultId: undefined,
	};
}

/** Swap the active backend for the stashed one. Returns false when already in
 *  the target mode. Non-destructive: the outgoing backend's URL and credentials
 *  are stashed, so switching back needs no re-authentication.
 *
 *  The caller is responsible for tearing down connections bound to the OLD
 *  backend (auth provider, note stream) before persisting. */
export function switchMode(
	settings: EngramSyncSettings,
	target: BackendMode,
	cloudUrl: string,
): boolean {
	if (settings.backendMode === target) return false;

	const outgoing = captureSlot(settings);
	const stash = settings.inactiveBackend;
	// A slot without a string apiUrl is corrupt or partial. Fall back to empty
	// rather than restoring half a backend.
	const incoming =
		stash && typeof stash.apiUrl === "string"
			? stash
			: emptySlot(target === "cloud" ? cloudUrl : "");

	applySlot(settings, incoming);
	// Cloud's URL is fixed and known, so an empty cloud slot is always seeded.
	if (target === "cloud" && !settings.apiUrl) settings.apiUrl = cloudUrl;

	settings.inactiveBackend = outgoing;
	settings.backendMode = target;
	return true;
}

/** One-time upgrade for installs that predate explicit backendMode. Infers the
 *  mode from the stored apiUrl, which was the old (derived) source of truth.
 *  Credentials are left exactly where they are: nobody is signed out.
 *
 *  MUST run AFTER migrateCloudApiUrl, which normalizes a legacy Cloud host onto
 *  ENGRAM_CLOUD_URL. Running first would read the un-normalized URL and
 *  misclassify a legacy Cloud install as self-hosted. */
export function migrateBackendMode(settings: EngramSyncSettings, cloudUrl: string): boolean {
	if (settings.backendMode === "cloud" || settings.backendMode === "selfhost") return false;
	settings.backendMode = settings.apiUrl === cloudUrl ? "cloud" : "selfhost";
	return true;
}

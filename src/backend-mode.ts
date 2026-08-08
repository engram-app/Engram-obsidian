import { BACKEND_SCOPED_FIELDS, type BackendSlot, type EngramSyncSettings } from "./types";

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

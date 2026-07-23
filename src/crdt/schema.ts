/**
 * One-time v1-doc IndexedDB wipe on schema upgrade.
 *
 * Pre-1.10 (proto-1) local docs carry the frontmatter fence inside the body
 * Y.Text under the SAME IndexedDB store names as v2. The server heals
 * fence-in-body on shared lineages (normalize_doc), but a v1 doc whose server
 * state was wiped (sanctioned pre-launch) re-merges as an independent lineage
 * → duplication. With Task 1 the client never seeds pre-handshake, but the v1
 * doc is already non-empty, so Task 1's gate doesn't cover it. Kill the class:
 * one-time wipe of all local CRDT stores when the stored schema version < 2;
 * docs rebuild from the server over the normal handshake. Un-pushed local edits
 * survive on DISK (disk is the source the reconcile pushes).
 */

/**
 * Injected storage interface (typically window.localStorage).
 */
interface Storage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/**
 * Injected IndexedDB wrapper interface.
 */
interface IndexedDBWrapper {
	list(): Promise<{ name?: string }[]>;
	drop(name: string): Promise<void>;
}

/**
 * One-time schema upgrade: wipe all CRDT stores for a vault if the schema
 * marker is absent or < 2.
 *
 * Storage key: `engram-crdt-doc-schema/${vaultId}`, value `"2"`. When the key
 * is absent or < 2: list databases, drop every one whose name starts with
 * `${vaultId}/`, then set the key. Returns true when a wipe ran.
 *
 * @param vaultId The vault ID (used as the database name prefix)
 * @param storage Pick<Storage, "getItem" | "setItem"> (typically window.localStorage)
 * @param dbs Injected IndexedDB wrapper (so logic is unit-testable)
 * @returns true when a wipe ran; false if marker already at "2"
 */
export async function ensureDocSchema(
	vaultId: string,
	storage: Pick<Storage, "getItem" | "setItem">,
	dbs: IndexedDBWrapper,
): Promise<boolean> {
	const markerKey = `engram-crdt-doc-schema/${vaultId}`;
	const currentMarker = storage.getItem(markerKey);

	// If marker is already "2", no wipe needed.
	if (currentMarker === "2") {
		return false;
	}

	// Marker is absent or < 2: wipe all ${vaultId}/ -prefixed databases.
	const allDbs = await dbs.list();
	const prefix = `${vaultId}/`;
	const dbsToWipe = allDbs
		.filter((db): db is { name: string } => db.name?.startsWith(prefix) ?? false)
		.map((db) => db.name);

	// Drop all prefixed databases.
	for (const name of dbsToWipe) {
		await dbs.drop(name);
	}

	// Set the marker AFTER all drops complete.
	storage.setItem(markerKey, "2");

	return true;
}

// Wired in main.ts (connectChannel) before constructing CrdtManager — see the
// ensureDocSchema call there for the real adapter. (A full code sample lived
// here once and drifted from the real wiring; the call site is the reference.)

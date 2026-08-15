/**
 * One struct holding every copy of a note, side by side.
 *
 * Ported from Relay (`src/RelayDebugAPI.ts` `DocumentSnapshot`). Today, working
 * out why a note diverged means reading `remote-log` output in Loki backwards
 * and inferring state that was never recorded directly. Every CRDT incident in
 * our history opened with the same half hour of "which copy is wrong". This
 * answers that in one call.
 *
 * Two deliberate design choices:
 *
 * 1. **Content is withheld by default.** Note bodies are private, and a
 *    snapshot is exactly the kind of thing that gets pasted into a support
 *    ticket. Lengths and hashes are always present so the two sides stay
 *    comparable; the text itself is never included — see debug-api.
 *
 * 2. **Every section degrades independently.** A snapshot that throws on the
 *    broken state it exists to describe is useless precisely when it is needed,
 *    so a failing section becomes `null` plus an entry in `errors`.
 *
 * ponytail: no separate IndexedDB replay. The resident doc is hydrated FROM
 * IndexedDB, so a doc/idb split is only visible in the narrow window before
 * `entry.ready` resolves. Upgrade path if that window ever matters: open the
 * store, replay into a throwaway Y.Doc, and add an `idb` section beside `doc`.
 */

import { fnv1a } from "./content-hash";
import type { FileSyncState } from "./types";

export interface SnapshotContentView {
	length: number;
	/** FNV-1a of the content. Present even when the content itself is withheld,
	 *  so doc and disk remain comparable in a redacted snapshot. */
	hash: string;
	content?: string;
}

export interface DocView extends SnapshotContentView {
	/** Whether the Y.Doc carries prior history (an LCA exists in CRDT terms). */
	hasHistory: boolean;
	/** Byte length of the doc's state vector. A cheap proxy for lineage size. */
	stateVectorBytes: number;
}

export interface DiskView extends SnapshotContentView {
	mtime: number;
}

export interface RoomView {
	resident: boolean;
	enrolled: boolean;
	synced: boolean;
	pendingGap: boolean;
	undelivered: boolean;
	removed: boolean;
	liveBound: boolean;
}

export interface ServerView {
	crdtHead?: string;
	serverHash?: string;
	version?: number;
	seq?: number;
	/** Last-synced content hash this device recorded. */
	syncedHash?: number;
}

export interface NoteSnapshot {
	path: string | null;
	noteId: string | null;
	idmap: {
		idForPath: string | null;
		pathForId: string | null;
		/** False when the two directions disagree — the drift that strands flushes. */
		bijective: boolean;
	};
	doc: DocView | null;
	disk: DiskView | null;
	server: ServerView | null;
	room: RoomView;
	/** True/false when both sides were readable, null when either failed. */
	docMatchesDisk: boolean | null;
	/** The server is known to hold a row for this note (a crdtHead was recorded). */
	hasServerNote: boolean;
	/** Sections that could not be read, as `"<section>: <reason>"`. */
	errors: string[];
}

export interface VaultSnapshot {
	rooms: { resident: number; enrolled: number; removed: number };
	/** Outstanding async work, oldest first. */
	pending: { label: string; ageMs: number }[];
}

/** Narrow structural view of ProviderRegistry — keeps this module testable
 *  without standing up IndexedDB or a socket. */
export interface SnapshotRegistry {
	hasDoc(noteId: string): boolean;
	projectedText(noteId: string): Promise<string>;
	hasHistory(noteId: string): Promise<boolean>;
	encodeStateVector(noteId: string): Promise<Uint8Array>;
	isSynced(noteId: string): boolean;
	hasPendingGap(noteId: string): Promise<boolean>;
	hasUndeliveredOps(noteId: string): boolean;
	enrolled: ReadonlySet<string>;
	removedIds: ReadonlySet<string>;
	residentIds(): string[];
}

export interface SnapshotDeps {
	idForPath(path: string): string | null;
	pathForId(noteId: string): string | null;
	registry: SnapshotRegistry;
	readDisk(path: string): Promise<{ length: number; mtime: number; content: string } | null>;
	syncStateFor(path: string): FileSyncState | undefined;
	isLiveBound(path: string): boolean;
	pendingPromises(): { label: string; ageMs: number }[];
}

const hashOf = (content: string): string => fnv1a(content).toString(16);

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Resolve a user-supplied key, which may be either a vault path or a note_id.
 *
 * Accepting both matters in practice: the wire and the logs are id-keyed while
 * the user thinks in paths, so an investigation starts from whichever one the
 * evidence happened to contain.
 */
function resolveKey(
	key: string,
	deps: SnapshotDeps,
): { path: string | null; noteId: string | null } {
	const idFromPath = deps.idForPath(key);
	if (idFromPath) return { path: key, noteId: idFromPath };

	const pathFromId = deps.pathForId(key);
	if (pathFromId) return { path: pathFromId, noteId: key };

	// Unmapped. Treat it as a path so the disk section can still be read — a
	// file that exists on disk with no id is itself a finding.
	return { path: key, noteId: null };
}

export async function buildNoteSnapshot(key: string, deps: SnapshotDeps): Promise<NoteSnapshot> {
	const errors: string[] = [];
	const { path, noteId } = resolveKey(key, deps);

	const idForPath = path ? deps.idForPath(path) : null;
	const pathForId = noteId ? deps.pathForId(noteId) : null;

	const removed = noteId ? deps.registry.removedIds.has(noteId) : false;
	const resident = noteId ? deps.registry.hasDoc(noteId) : false;

	let doc: DocView | null = null;
	let docContent: string | null = null;
	if (noteId && resident) {
		try {
			const content = await deps.registry.projectedText(noteId);
			docContent = content;
			doc = {
				length: content.length,
				hash: hashOf(content),
				hasHistory: await deps.registry.hasHistory(noteId),
				stateVectorBytes: (await deps.registry.encodeStateVector(noteId)).byteLength,
			};
		} catch (e) {
			errors.push(`doc: ${describe(e)}`);
		}
	}

	let disk: DiskView | null = null;
	let diskContent: string | null = null;
	if (path) {
		try {
			const read = await deps.readDisk(path);
			if (read) {
				diskContent = read.content;
				disk = {
					length: read.length,
					hash: hashOf(read.content),
					mtime: read.mtime,
				};
			}
		} catch (e) {
			errors.push(`disk: ${describe(e)}`);
		}
	}

	let pendingGap = false;
	if (noteId && resident) {
		try {
			pendingGap = await deps.registry.hasPendingGap(noteId);
		} catch (e) {
			errors.push(`room: ${describe(e)}`);
		}
	}

	const state = path ? deps.syncStateFor(path) : undefined;

	return {
		path,
		noteId,
		idmap: {
			idForPath,
			pathForId,
			// Both directions present and agreeing = healthy. Neither present =
			// nothing to disagree about (an unmapped path is reported elsewhere).
			// Exactly ONE present = the two directions have drifted apart, which is
			// the half-mapped state that strands flushes — it must not read as
			// healthy just because nothing contradicts it.
			bijective: idForPath && pathForId ? pathForId === path : !idForPath && !pathForId,
		},
		doc,
		disk,
		server: state
			? {
					crdtHead: state.crdtHead,
					serverHash: state.serverHash,
					version: state.version,
					seq: state.seq,
					syncedHash: state.hash,
				}
			: null,
		room: {
			resident,
			enrolled: noteId ? deps.registry.enrolled.has(noteId) : false,
			synced: noteId ? deps.registry.isSynced(noteId) : false,
			pendingGap,
			undelivered: noteId ? deps.registry.hasUndeliveredOps(noteId) : false,
			removed,
			liveBound: path ? deps.isLiveBound(path) : false,
		},
		docMatchesDisk:
			docContent !== null && diskContent !== null ? docContent === diskContent : null,
		hasServerNote: state?.crdtHead != null,
		errors,
	};
}

export function buildVaultSnapshot(deps: SnapshotDeps): VaultSnapshot {
	return {
		rooms: {
			resident: deps.registry.residentIds().length,
			enrolled: deps.registry.enrolled.size,
			removed: deps.registry.removedIds.size,
		},
		// Oldest first: a wedged operation is the one worth seeing, and it is the
		// one that has been outstanding longest.
		pending: [...deps.pendingPromises()].sort((a, b) => b.ageMs - a.ageMs),
	};
}

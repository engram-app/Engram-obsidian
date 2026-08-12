import type { SyncChoice, SyncPlan } from "./types";
import { DESTRUCTIVE_CHOICES } from "./types";

/** "N thing"/"N things". The one pluralizer — this ternary was hand-rolled at
 *  7 call sites across the sync UI. */
export function plural(count: number, singular: string): string {
	return `${count} ${pluralWord(count, singular)}`;
}

/** Just the (naively pluralized) word. */
export function pluralWord(count: number, singular: string): string {
	return count === 1 ? singular : `${singular}s`;
}

/** True when the plan has nothing for the engine to do. */
export function isPlanEmpty(plan: SyncPlan): boolean {
	return (
		plan.toPush.notes.length === 0 &&
		plan.toPush.attachments.length === 0 &&
		plan.toPull.notes.length === 0 &&
		plan.toPull.attachments.length === 0 &&
		plan.conflicts.length === 0 &&
		plan.toDeleteLocal.length === 0 &&
		plan.toDeleteRemote.length === 0
	);
}

/** Returns 0–100. |local ∩ remote| / |local ∪ remote| over note paths only.
 *  Empty-empty is defined as 100 (vacuously a perfect match). */
export function computeMatchPercent(plan: SyncPlan): number {
	const local = plan.localNoteCount;
	const remote = plan.serverNoteCount;
	if (local === 0 && remote === 0) return 100;

	const localOnly = plan.toPush.notes.length;
	const intersection = Math.max(0, local - localOnly); // notes present on both sides
	const union = local + Math.max(0, remote - intersection);
	if (union === 0) return 100;
	return Math.round((intersection / union) * 100);
}

export type DeletionTreeRow =
	| { kind: "folder"; depth: number; label: string; deleted: boolean }
	| { kind: "file"; depth: number; label: string };

/** Set of every folder prefix touched by the given paths. "a/b/file.md"
 *  contributes both "a" and "a/b". Used to test whether any surviving path
 *  lives inside a given folder. */
function folderPrefixesOf(paths: Iterable<string>): Set<string> {
	const set = new Set<string>();
	for (const p of paths) {
		const parts = p.split("/");
		let prefix = "";
		for (let i = 0; i < parts.length - 1; i++) {
			prefix = prefix ? `${prefix}/${parts[i]}` : (parts[i] ?? "");
			set.add(prefix);
		}
	}
	return set;
}

/** Build a folder/file tree from a flat list of vault paths. Folders are
 *  emitted once even when they contain multiple deleted files.
 *
 *  When `keptPaths` is provided, a folder row is marked `deleted: true` when
 *  no path in that set has the folder as a prefix — i.e. the folder is going
 *  away entirely, not just losing some leaves. Without `keptPaths` every
 *  folder defaults to `deleted: false` (caller is opting out of the
 *  full-vs-partial distinction). */
export function buildDeletionTree(
	paths: string[],
	keptPaths?: Iterable<string>,
): DeletionTreeRow[] {
	const sorted = [...paths].sort();
	const rows: DeletionTreeRow[] = [];
	const emittedFolders = new Set<string>();
	const survivingFolders = keptPaths ? folderPrefixesOf(keptPaths) : null;

	for (const path of sorted) {
		const parts = path.split("/");
		const folders = parts.slice(0, -1);
		const file = parts[parts.length - 1] ?? "";

		let prefix = "";
		for (let i = 0; i < folders.length; i++) {
			const folder = folders[i] ?? "";
			prefix = prefix ? `${prefix}/${folder}` : folder;
			if (!emittedFolders.has(prefix)) {
				emittedFolders.add(prefix);
				const deleted = survivingFolders ? !survivingFolders.has(prefix) : false;
				rows.push({ kind: "folder", depth: i, label: `${folder}/`, deleted });
			}
		}

		rows.push({ kind: "file", depth: folders.length, label: file });
	}

	return rows;
}

/** True for choices that bulk-delete data on either side. Drives the
 *  typed-DELETE confirm gate in the modal. */
export function isDestructiveChoice(choice: SyncChoice): boolean {
	return DESTRUCTIVE_CHOICES.has(choice);
}

export interface OptionBreakdown {
	/** Total notes + attachments to pull from server. */
	pullCount: number;
	/** Total notes + attachments to push to server. */
	pushCount: number;
	/** Conflicts that will go through 3-way merge (smart-merge only). */
	conflictCount: number;
	/** Local files that will be deleted as a side effect. */
	deleteLocalCount: number;
	/** Remote files that will be deleted as a side effect. */
	deleteRemoteCount: number;
}

/** Per-option preview math. Derives action counts and a sample path list from
 *  a single SyncPlan so each option card in the modal can render its own
 *  numbers without the caller re-deriving them.
 *
 *  Counts are total files (notes + attachments) to match what the engine
 *  actually moves. Conflict count stays notes-only because the conflict
 *  modal only handles text content. */
export function optionBreakdown(plan: SyncPlan, choice: SyncChoice): OptionBreakdown {
	switch (choice) {
		case "smart-merge":
			return {
				pullCount: plan.toPull.notes.length + plan.toPull.attachments.length,
				pushCount: plan.toPush.notes.length + plan.toPush.attachments.length,
				conflictCount: plan.conflicts.length,
				deleteLocalCount: 0,
				deleteRemoteCount: 0,
			};

		case "pull-all-delete-local": {
			const localOnly = [...plan.toPush.notes, ...plan.toPush.attachments];
			return {
				pullCount: plan.serverNoteCount + plan.serverAttachmentCount,
				pushCount: 0,
				conflictCount: 0,
				deleteLocalCount: localOnly.length,
				deleteRemoteCount: 0,
			};
		}

		case "pull-all-keep-local":
			return {
				pullCount: plan.serverNoteCount + plan.serverAttachmentCount,
				pushCount: 0,
				conflictCount: 0,
				deleteLocalCount: 0,
				deleteRemoteCount: 0,
			};

		case "push-all-delete-remote": {
			const remoteOnly = [...plan.toPull.notes, ...plan.toPull.attachments];
			return {
				pullCount: 0,
				pushCount: plan.localNoteCount + plan.localAttachmentCount,
				conflictCount: 0,
				deleteLocalCount: 0,
				deleteRemoteCount: remoteOnly.length,
			};
		}

		case "push-all-keep-remote":
			return {
				pullCount: 0,
				pushCount: plan.localNoteCount + plan.localAttachmentCount,
				conflictCount: 0,
				deleteLocalCount: 0,
				deleteRemoteCount: 0,
			};

		case "cancel":
		case "change-vault":
			return {
				pullCount: 0,
				pushCount: 0,
				conflictCount: 0,
				deleteLocalCount: 0,
				deleteRemoteCount: 0,
			};
	}
}

/** The one-click first-sync decision. When exactly one side is empty there is
 *  a single sane action — a non-destructive merge that uploads or downloads
 *  everything — so the five-option preview is ceremony (and its delete
 *  variants are a foot-gun on an onboarding screen). Both sides populated →
 *  null → full preview: that is the only case a human needs to weigh.
 *
 *  Safety invariant: every simplified mode maps to smart-merge. If an "empty"
 *  verdict is ever wrong (partial enumeration), a merge costs nothing — it
 *  never deletes. The delete variants stay unreachable from these screens. */
export type SimplifiedFirstSync =
	| { mode: "upload"; notes: number; attachments: number }
	| { mode: "download"; notes: number; attachments: number }
	| { mode: "fresh" };

export function simplifiedFirstSync(plan: SyncPlan): SimplifiedFirstSync | null {
	// Simplify ONLY when the plan itself is one clean direction. The counts
	// alone LIE in exactly the dangerous cases: serverNoteCount counts live
	// rows, so a fully-TOMBSTONED server vault reads "empty" while smart-merge
	// would apply those tombstones and wipe the local vault behind an explicit
	// no-deletion promise (review finding — the data-loss trap). Any pending
	// deletion, conflict, or counter-direction transfer disqualifies.
	if (
		plan.toDeleteLocal.length > 0 ||
		plan.toDeleteRemote.length > 0 ||
		plan.conflicts.length > 0
	) {
		return null;
	}
	const remote = plan.serverNoteCount + plan.serverAttachmentCount;
	const local = plan.localNoteCount + plan.localAttachmentCount;
	const pulls = plan.toPull.notes.length + plan.toPull.attachments.length;
	const pushes = plan.toPush.notes.length + plan.toPush.attachments.length;
	if (remote === 0 && local === 0) {
		return pulls + pushes === 0 ? { mode: "fresh" } : null;
	}
	if (remote === 0) {
		if (pulls > 0) return null; // counter-direction: the "empty" read is stale
		return {
			mode: "upload",
			notes: plan.localNoteCount,
			attachments: plan.localAttachmentCount,
		};
	}
	if (local === 0) {
		if (pushes > 0) return null;
		return {
			mode: "download",
			notes: plan.serverNoteCount,
			attachments: plan.serverAttachmentCount,
		};
	}
	return null;
}

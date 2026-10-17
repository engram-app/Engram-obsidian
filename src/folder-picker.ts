/**
 * folder-picker.ts: choose which top-level folders sync, with a per-folder
 * note count and an optional running total against a limit.
 *
 * UI-agnostic of the first-sync flow on purpose: it is meant to back the
 * ignore-path setting later. The logic lives in pure functions so it is tested
 * without a DOM; the class only walks their results.
 *
 * Exclusions are stored as top-level folder names in `settings.excludedFolders`
 * (never in the user's ignore text). The picker counts with the same
 * `inExcludedFolder` (ignore-match.ts) that `SyncEngine.shouldIgnore` uses, so
 * its "Selected" total is exactly what will sync.
 */
import { formatNumber, t } from "./i18n";
import { inExcludedFolder, ROOT_FOLDER } from "./ignore-match";

export { ROOT_FOLDER };

function topFolder(path: string): string {
	const slash = path.indexOf("/");
	return slash < 0 ? ROOT_FOLDER : path.slice(0, slash);
}

export interface FolderCount {
	folder: string;
	count: number;
}

/** Notes per top-level folder, root first, then by name. */
export function countNotesByFolder(paths: string[]): FolderCount[] {
	const counts = new Map<string, number>();
	for (const p of paths) {
		const f = topFolder(p);
		counts.set(f, (counts.get(f) ?? 0) + 1);
	}
	return [...counts]
		.map(([folder, count]) => ({ folder, count }))
		.sort((a, b) =>
			a.folder === ROOT_FOLDER
				? -1
				: b.folder === ROOT_FOLDER
					? 1
					: a.folder.localeCompare(b.folder),
		);
}

/** How many of `paths` still sync with `excluded` left out. Uses the engine's
 *  matcher, so the count is exactly what shouldIgnore will do. */
export function selectedNoteCount(paths: string[], excluded: Iterable<string>): number {
	const ex = [...excluded];
	return paths.filter((p) => !inExcludedFolder(p, ex)).length;
}

export interface FolderPickerProps {
	/** Every syncable note path the choice applies to. */
	notePaths: string[];
	/** The subset of notePaths not yet uploaded. When set, rows read "Archive
	 *  2,300 notes (2,000 new)", only folders with new notes are listed, and
	 *  the total and `limit` count new notes only. */
	newPaths?: string[];
	/** Top-level folders that start unticked. ROOT_FOLDER is ignored: the
	 *  root row is locked on. */
	excluded: string[];
	/** When set, shows "Selected: N / limit" and an over-limit state. */
	limit?: number | null;
	/** Fires with the full excluded list and the counted notes still selected
	 *  on every toggle. */
	onChange: (excluded: string[], selected: number) => void;
}

export class FolderPicker {
	private readonly excluded: Set<string>;
	private total: HTMLElement | null = null;

	constructor(
		parent: HTMLElement,
		private readonly props: FolderPickerProps,
	) {
		this.excluded = new Set(props.excluded.filter((f) => f !== ROOT_FOLDER));
		const list = parent.createEl("ul", { cls: "engram-folder-picker" });
		const all = countNotesByFolder(props.notePaths);
		const totals = new Map(all.map((c) => [c.folder, c.count]));
		const rows = props.newPaths ? countNotesByFolder(props.newPaths) : null;
		for (const { folder, count } of rows ?? all) {
			const label = list.createEl("li").createEl("label");
			const box = label.createEl("input", { type: "checkbox" });
			box.checked = !this.excluded.has(folder);
			const name = folder === ROOT_FOLDER ? t("(top level)") : folder;
			const total = totals.get(folder) ?? count;
			label.createSpan({
				text: rows
					? t("{folder} {count} notes ({newCount} new)", {
							folder: name,
							count: total,
							newCount: formatNumber(count),
						})
					: `${name} (${formatNumber(count)})`,
			});
			// Root notes always sync: nothing else in the vault anchors them.
			if (folder === ROOT_FOLDER) {
				box.disabled = true;
				continue;
			}
			box.addEventListener("change", () => {
				if (box.checked) this.excluded.delete(folder);
				else this.excluded.add(folder);
				const selected = this.selected();
				this.updateTotal(selected);
				props.onChange([...this.excluded], selected);
			});
		}
		if (props.limit != null) {
			this.total = parent.createEl("p", { cls: "engram-folder-picker-total" });
			this.updateTotal(this.selected());
		}
	}

	/** Counted notes (new ones, when newPaths is set) the selection keeps. */
	private selected(): number {
		return selectedNoteCount(this.props.newPaths ?? this.props.notePaths, this.excluded);
	}

	private updateTotal(selected: number): void {
		const limit = this.props.limit;
		if (!this.total || limit == null) return;
		this.total.setText(
			t("Selected: {selected} / {limit}", {
				selected: formatNumber(selected),
				limit: formatNumber(limit),
			}),
		);
		this.total.toggleClass("is-over", selected > limit);
	}
}

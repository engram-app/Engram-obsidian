/**
 * folder-picker.ts — choose which top-level folders sync, with a per-folder
 * note count and an optional running total against a limit.
 *
 * UI-agnostic of the first-sync flow on purpose: it is meant to back the
 * ignore-path setting later. The logic lives in pure functions so it is tested
 * without a DOM; the class only walks their results.
 *
 * Exclusions become lines in `settings.ignorePatterns`, so the semantics here
 * MUST be the ones `SyncEngine.shouldIgnore` applies. That is why
 * `matchesIgnorePattern` lives here and the engine calls it: one matcher, so
 * the picker's "Selected" total is exactly what will sync.
 */
import { currentLocale, t } from "./i18n";

/** Key of the "(top level)" pseudo-folder holding notes at the vault root. */
export const ROOT_FOLDER = "";

/** Does one `ignorePatterns` line match `path`? A trailing "/" is a folder
 *  prefix, anything else an exact file name. Unanchored, both match at the root
 *  or nested. A leading "/" anchors to the vault root ("/Archive/" is only the
 *  top-level Archive). Vault paths never start with "/", so before anchoring a
 *  leading-"/" line matched nothing; no existing pattern changes meaning.
 *  Neither glob nor regex. */
export function matchesIgnorePattern(path: string, pattern: string): boolean {
	if (pattern.startsWith("/")) {
		const anchored = pattern.slice(1);
		return anchored.endsWith("/") ? path.startsWith(anchored) : path === anchored;
	}
	if (pattern.endsWith("/")) {
		return path.startsWith(pattern) || path.includes(`/${pattern}`);
	}
	return path === pattern || path.endsWith(`/${pattern}`);
}

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

/** The `ignorePatterns` lines that exclude `excluded`: one root-anchored
 *  folder line each. The root pseudo-folder writes nothing, root notes always
 *  sync. */
export function excludedToIgnorePatterns(excluded: Iterable<string>): string[] {
	return [...excluded].filter((f) => f !== ROOT_FOLDER).map((f) => `/${f}/`);
}

/** How many of `paths` still sync once `excluded` is written as patterns.
 *  Uses the real matcher, so the count is exactly what shouldIgnore will do. */
export function selectedNoteCount(paths: string[], excluded: Iterable<string>): number {
	const patterns = excludedToIgnorePatterns(excluded);
	if (patterns.length === 0) return paths.length;
	return paths.filter((p) => !patterns.some((pt) => matchesIgnorePattern(p, pt))).length;
}

/** Append `add` to the newline-separated `ignorePatterns` setting, dropping
 *  blanks and duplicates. Existing lines keep their order. */
export function mergeIgnorePatterns(existing: string, add: string[]): string {
	const lines = existing
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	for (const p of add) if (!lines.includes(p)) lines.push(p);
	return lines.join("\n");
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
		const totals = new Map(countNotesByFolder(props.notePaths).map((c) => [c.folder, c.count]));
		const rows = props.newPaths ? countNotesByFolder(props.newPaths) : null;
		for (const { folder, count } of rows ?? countNotesByFolder(props.notePaths)) {
			const label = list.createEl("li").createEl("label");
			const box = label.createEl("input", { type: "checkbox" });
			box.checked = !this.excluded.has(folder);
			const name = folder === ROOT_FOLDER ? t("(top level)") : folder;
			const fmt = (n: number) => n.toLocaleString(currentLocale());
			const total = totals.get(folder) ?? count;
			label.createSpan({
				text: rows
					? t("{folder} {count} notes ({newCount} new)", {
							folder: name,
							count: total,
							newCount: fmt(count),
						})
					: `${name} (${fmt(count)})`,
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
		const fmt = (n: number) => n.toLocaleString(currentLocale());
		this.total.setText(
			t("Selected: {selected} / {limit}", { selected: fmt(selected), limit: fmt(limit) }),
		);
		this.total.toggleClass("is-over", selected > limit);
	}
}

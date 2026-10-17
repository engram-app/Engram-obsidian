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
 *  prefix (matched at the root or nested), anything else an exact file name
 *  (at the root or nested). Neither glob nor regex. */
export function matchesIgnorePattern(path: string, pattern: string): boolean {
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

/** The `ignorePatterns` lines that exclude `excluded`. A folder is one prefix
 *  line; the root pseudo-folder has no prefix, so it is one line per root note. */
export function excludedToIgnorePatterns(excluded: Iterable<string>, paths: string[]): string[] {
	const out: string[] = [];
	for (const folder of excluded) {
		if (folder === ROOT_FOLDER) {
			out.push(...paths.filter((p) => !p.includes("/")).sort());
		} else {
			out.push(`${folder}/`);
		}
	}
	return out;
}

/** How many of `paths` still sync once `excluded` is written as patterns.
 *  Uses the real matcher, so a folder name that also appears nested
 *  ("Arch/" catches "Projects/Arch/") is counted the way it will behave. */
export function selectedNoteCount(paths: string[], excluded: Iterable<string>): number {
	const patterns = excludedToIgnorePatterns(excluded, paths);
	if (patterns.length === 0) return paths.length;
	// ponytail: O(notes x patterns) per toggle; fine for a few thousand notes,
	// index patterns by kind if a huge root ever makes toggling lag.
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
	/** Top-level folders that start unticked (ROOT_FOLDER for the root). */
	excluded: string[];
	/** When set, shows "Selected: N / limit" and an over-limit state. */
	limit?: number | null;
	/** Fires with the full excluded list on every toggle. */
	onChange: (excluded: string[]) => void;
}

export class FolderPicker {
	private readonly excluded: Set<string>;
	private total: HTMLElement | null = null;

	constructor(
		parent: HTMLElement,
		private readonly props: FolderPickerProps,
	) {
		this.excluded = new Set(props.excluded);
		const list = parent.createEl("ul", { cls: "engram-folder-picker" });
		for (const { folder, count } of countNotesByFolder(props.notePaths)) {
			const label = list.createEl("li").createEl("label");
			const box = label.createEl("input", { type: "checkbox" });
			box.checked = !this.excluded.has(folder);
			const name = folder === ROOT_FOLDER ? t("(top level)") : folder;
			label.createSpan({ text: `${name} (${count.toLocaleString(currentLocale())})` });
			box.addEventListener("change", () => {
				if (box.checked) this.excluded.delete(folder);
				else this.excluded.add(folder);
				this.updateTotal();
				props.onChange([...this.excluded]);
			});
		}
		if (props.limit != null) {
			this.total = parent.createEl("p", { cls: "engram-folder-picker-total" });
			this.updateTotal();
		}
	}

	private updateTotal(): void {
		const limit = this.props.limit;
		if (!this.total || limit == null) return;
		const selected = selectedNoteCount(this.props.notePaths, this.excluded);
		const fmt = (n: number) => n.toLocaleString(currentLocale());
		this.total.setText(
			t("Selected: {selected} / {limit}", { selected: fmt(selected), limit: fmt(limit) }),
		);
		this.total.toggleClass("is-over", selected > limit);
	}
}

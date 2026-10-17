import { afterAll, describe, expect, mock, test } from "bun:test";
import {
	countNotesByFolder,
	FolderPicker,
	ROOT_FOLDER,
	selectedNoteCount,
} from "../src/folder-picker";
import { t } from "../src/i18n";
import { inExcludedFolder, matchesIgnorePattern } from "../src/ignore-match";
import { __setLanguage, makeEl } from "./__mocks__/obsidian";

const PATHS = [
	"Inbox.md",
	"Todo.md",
	"Arch/plan.md",
	"Archive/2023/a.md",
	"Archive/2023/b.md",
	"Archive/c.md",
	"Projects/Arch/x.md",
	"Projects/y.md",
];

describe("countNotesByFolder", () => {
	test("groups by top-level folder, nested paths count toward their top folder, root first", () => {
		expect(countNotesByFolder(PATHS)).toEqual([
			{ folder: ROOT_FOLDER, count: 2 },
			{ folder: "Arch", count: 1 },
			{ folder: "Archive", count: 3 },
			{ folder: "Projects", count: 2 },
		]);
	});

	test("empty input gives no folders", () => {
		expect(countNotesByFolder([])).toEqual([]);
	});

	test("no root row when every note is in a folder", () => {
		expect(countNotesByFolder(["A/x.md"])).toEqual([{ folder: "A", count: 1 }]);
	});
});

describe("inExcludedFolder", () => {
	test("`except` skips that one folder without copying the list", () => {
		expect(inExcludedFolder("Archive/a.md", ["Old", "Archive"], "Archive")).toBe(false);
		expect(inExcludedFolder("Old/a.md", ["Old", "Archive"], "Archive")).toBe(true);
	});

	test("matches only the top-level folder itself, anchored at the root", () => {
		expect(inExcludedFolder("Archive/a.md", ["Archive"])).toBe(true);
		expect(inExcludedFolder("Archive/2023/a.md", ["Archive"])).toBe(true);
		expect(inExcludedFolder("Projects/Archive/a.md", ["Archive"])).toBe(false);
		expect(inExcludedFolder("Archived/a.md", ["Archive"])).toBe(false);
	});

	test("the top-level pseudo-folder excludes nothing: root notes always sync", () => {
		expect(inExcludedFolder("Root.md", [ROOT_FOLDER])).toBe(false);
	});

	test("nothing excluded matches nothing", () => {
		expect(inExcludedFolder("Archive/a.md", [])).toBe(false);
	});
});

describe("matchesIgnorePattern", () => {
	test("a folder pattern does not match a sibling sharing its prefix", () => {
		expect(matchesIgnorePattern("Arch/plan.md", "Arch/")).toBe(true);
		expect(matchesIgnorePattern("Archive/c.md", "Arch/")).toBe(false);
	});

	test("a file pattern matches the exact path", () => {
		expect(matchesIgnorePattern("Inbox.md", "Inbox.md")).toBe(true);
		expect(matchesIgnorePattern("Inbox.md.bak", "Inbox.md")).toBe(false);
	});

	test("a leading / keeps its origin/main meaning: a no-op line", () => {
		// Regression: vault paths never start with "/", so these lines matched
		// nothing on origin/main and must keep matching nothing.
		expect(matchesIgnorePattern("Projects/a.md", "/Projects/")).toBe(false);
		expect(matchesIgnorePattern("README.md", "/README.md")).toBe(false);
	});

	test("unanchored patterns keep their origin/main meaning: match at any depth", () => {
		// Regression: these are the pre-anchor semantics users already rely on.
		expect(matchesIgnorePattern("Archive/a.md", "Archive/")).toBe(true);
		expect(matchesIgnorePattern("Projects/Archive/a.md", "Archive/")).toBe(true);
		expect(matchesIgnorePattern("README.md", "README.md")).toBe(true);
		expect(matchesIgnorePattern("docs/README.md", "README.md")).toBe(true);
		expect(matchesIgnorePattern("docs/README.md.bak", "README.md")).toBe(false);
	});
});

describe("selectedNoteCount", () => {
	test("all selected when nothing is excluded", () => {
		expect(selectedNoteCount(PATHS, [])).toBe(8);
	});

	test("excluding a folder drops exactly what the ignore patterns would drop", () => {
		expect(selectedNoteCount(PATHS, ["Archive"])).toBe(5);
		// Anchored: the nested Projects/Arch/ folder is not the one unticked.
		expect(selectedNoteCount(PATHS, ["Arch"])).toBe(7);
	});

	test("the top level cannot be excluded", () => {
		expect(selectedNoteCount(PATHS, [ROOT_FOLDER])).toBe(8);
	});
});

/** The checkbox sharing a row with the element whose text is `text`. */
function checkboxFor(root: any, text: string): any {
	const row = (function walk(el: any): any {
		if (el.children.some((c: any) => c.textContent === text)) return el;
		return el.children.reduce((hit: any, c: any) => hit ?? walk(c), null);
	})(root);
	return row?.children.find((c: any) => c.tag === "input");
}

describe("FolderPicker", () => {
	// Every note new: the step's usual first-sync case.
	const pick = (excluded: string[], onChange = (_e: string[], _s: number) => {}) => {
		const parent = makeEl();
		new FolderPicker(parent, {
			notePaths: PATHS,
			newPaths: PATHS,
			excluded,
			limit: 6,
			onChange,
		});
		return parent;
	};

	test("renders one checkbox row per folder with its note count, root labelled", () => {
		const parent = pick([]);
		expect(parent.__find("(top level) 2 notes (2 new)")).not.toBeNull();
		expect(parent.__find("Archive 3 notes (3 new)")).not.toBeNull();
	});

	test("initial exclusions render unticked", () => {
		const parent = pick(["Archive"]);
		expect(checkboxFor(parent, "Archive 3 notes (3 new)").checked).toBe(false);
		expect(checkboxFor(parent, "Projects 2 notes (2 new)").checked).toBe(true);
	});

	test("unticking a folder updates the running total and reports the exclusion", () => {
		const onChange = mock((_ex: string[], _selected: number) => {});
		const parent = pick([], onChange);
		expect(parent.__find("Selected: 8 / 6")).not.toBeNull();

		const box = checkboxFor(parent, "Archive 3 notes (3 new)");
		box.checked = false;
		box.listeners.change();

		expect(onChange).toHaveBeenLastCalledWith(["Archive"], 5);
		expect(parent.__find("Selected: 5 / 6")).not.toBeNull();
	});

	test("the top-level row shows its count but is locked on", () => {
		const parent = pick([ROOT_FOLDER]);
		const root = checkboxFor(parent, "(top level) 2 notes (2 new)");
		expect(root.checked).toBe(true);
		expect(root.disabled).toBe(true);
		expect(root.listeners.change).toBeUndefined();
		expect(parent.__find("Selected: 8 / 6")).not.toBeNull();
	});
});

describe("FolderPicker pluralizes total and new counts separately", () => {
	afterAll(() => __setLanguage("en"));

	test("5 notes with 1 new picks each count's own plural form", () => {
		__setLanguage("pl");
		const parent = makeEl();
		const notes = ["A/1.md", "A/2.md", "A/3.md", "A/4.md", "A/5.md"];
		new FolderPicker(parent, {
			notePaths: notes,
			newPaths: ["A/1.md"],
			excluded: [],
			limit: 10,
			onChange: () => {},
		});
		const expected = `A ${t("{count} notes", { count: 5 })} (${t("{count} new", { count: 1 })})`;
		expect(parent.__find(expected)).not.toBeNull();
	});
});

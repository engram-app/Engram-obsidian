import { describe, expect, mock, test } from "bun:test";
import {
	countNotesByFolder,
	excludedToIgnorePatterns,
	FolderPicker,
	matchesIgnorePattern,
	mergeIgnorePatterns,
	ROOT_FOLDER,
	selectedNoteCount,
} from "../src/folder-picker";
import { makeEl } from "./__mocks__/obsidian";

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

describe("excludedToIgnorePatterns", () => {
	test("a folder becomes a trailing-slash prefix pattern", () => {
		expect(excludedToIgnorePatterns(["Archive"], PATHS)).toEqual(["Archive/"]);
	});

	test("the top-level pseudo-folder becomes one exact pattern per root note", () => {
		expect(excludedToIgnorePatterns([ROOT_FOLDER], PATHS)).toEqual(["Inbox.md", "Todo.md"]);
	});

	test("nothing excluded gives no patterns", () => {
		expect(excludedToIgnorePatterns([], PATHS)).toEqual([]);
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
});

describe("selectedNoteCount", () => {
	test("all selected when nothing is excluded", () => {
		expect(selectedNoteCount(PATHS, [])).toBe(8);
	});

	test("excluding a folder drops exactly what the ignore patterns would drop", () => {
		expect(selectedNoteCount(PATHS, ["Archive"])).toBe(5);
		// "Arch/" also matches the nested Projects/Arch/ folder (shouldIgnore
		// semantics), and the count must say so rather than promise 7.
		expect(selectedNoteCount(PATHS, ["Arch"])).toBe(6);
	});

	test("excluding the top level drops the root notes", () => {
		expect(selectedNoteCount(PATHS, [ROOT_FOLDER])).toBe(6);
	});
});

describe("mergeIgnorePatterns", () => {
	test("appends new patterns one per line after the existing ones", () => {
		expect(mergeIgnorePatterns("drafts/", ["Archive/"])).toBe("drafts/\nArchive/");
	});

	test("skips duplicates and blank lines", () => {
		expect(mergeIgnorePatterns("drafts/\n\nArchive/\n", ["Archive/", "Old/"])).toBe(
			"drafts/\nArchive/\nOld/",
		);
	});

	test("empty existing setting", () => {
		expect(mergeIgnorePatterns("", ["A/"])).toBe("A/");
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
	test("renders one checkbox row per folder with its note count, root labelled", () => {
		const parent = makeEl();
		new FolderPicker(parent, { notePaths: PATHS, excluded: [], onChange: () => {} });
		expect(parent.__find("(top level) (2)")).not.toBeNull();
		expect(parent.__find("Archive (3)")).not.toBeNull();
	});

	test("initial exclusions render unticked", () => {
		const parent = makeEl();
		new FolderPicker(parent, { notePaths: PATHS, excluded: ["Archive"], onChange: () => {} });
		expect(checkboxFor(parent, "Archive (3)").checked).toBe(false);
		expect(checkboxFor(parent, "Projects (2)").checked).toBe(true);
	});

	test("unticking a folder updates the running total and reports the exclusion", () => {
		const parent = makeEl();
		const onChange = mock((_ex: string[]) => {});
		new FolderPicker(parent, { notePaths: PATHS, excluded: [], limit: 6, onChange });
		expect(parent.__find("Selected: 8 / 6")).not.toBeNull();

		const box = checkboxFor(parent, "Archive (3)");
		box.checked = false;
		box.listeners.change();

		expect(onChange).toHaveBeenLastCalledWith(["Archive"]);
		expect(parent.__find("Selected: 5 / 6")).not.toBeNull();
	});

	test("without a limit it shows no running total", () => {
		const parent = makeEl();
		new FolderPicker(parent, { notePaths: PATHS, excluded: [], onChange: () => {} });
		const texts: string[] = [];
		(function walk(el: any) {
			texts.push(el.textContent);
			for (const c of el.children) walk(c);
		})(parent);
		expect(texts.some((x) => x.startsWith("Selected"))).toBe(false);
	});
});

/**
 * Guard against the one i18n defect that nothing else catches: a `t()` call
 * evaluated at module scope.
 *
 * `t()` resolves the language at call time. Put it in a top-level object or
 * array literal and the literal is evaluated once, when the bundle first
 * loads, so the string freezes to whichever language was active then and never
 * changes again. It typechecks, every unit test passes, the orphan guard is
 * happy, and the only symptom is a permanently-English label in the running
 * plugin.
 *
 * This bit five times while the UI was being localized (limit-copy's TABLE,
 * QUEUED_REASON_TEXT, PROBLEMATIC_DIRS, HEADER_BY_CONTEXT, MODE_LABELS). Each
 * fix was the same shape: turn the const map into a function so the lookup
 * happens per call.
 *
 * A top-level `const f = () => t("x")` is fine — the body is deferred — so the
 * scan only flags initializers that are plain object/array literals.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

const repoRoot = join(import.meta.dir, "..");

/** `t(` / `tInto(` as a call, not the tail of `split(` or `.at(`. */
const T_CALL = /(?<![A-Za-z0-9_$.])(?:t|tInto)\(/;

/**
 * Span of a top-level declaration's initializer, starting at the `{` or `[`
 * that opens it. Returns null when the declaration does not initialize to an
 * object/array literal (a function, a call, a bare value).
 */
function literalInitializer(src: string, declStart: number): string | null {
	const eq = src.indexOf("=", declStart);
	if (eq === -1) return null;
	// Everything up to the first literal opener. A `=>` or `function` in there
	// means the value is a deferred body, not data.
	let i = eq + 1;
	while (i < src.length && /\s/.test(src[i] ?? "")) i++;
	const open = src[i];
	if (open !== "{" && open !== "[") return null;

	const close = open === "{" ? "}" : "]";
	let depth = 0;
	for (let j = i; j < src.length; j++) {
		const ch = src[j];
		if (ch === open) depth++;
		else if (ch === close) {
			depth--;
			if (depth === 0) return src.slice(i, j + 1);
		}
	}
	return null;
}

/** Offsets of every declaration that starts at column 0 (module scope). */
function topLevelDecls(src: string): number[] {
	const out: number[] = [];
	const pattern = /^(?:export\s+)?(?:const|let|var)\s/gm;
	for (const m of src.matchAll(pattern)) {
		if (m.index !== undefined) out.push(m.index);
	}
	return out;
}

/** Index just past the balanced group opening at `i` (which must be a bracket). */
function skipBalanced(s: string, i: number): number {
	const open = s[i] ?? "";
	const close = open === "{" ? "}" : open === "(" ? ")" : "]";
	let depth = 0;
	for (let j = i; j < s.length; j++) {
		const ch = s[j];
		if (ch === open) depth++;
		else if (ch === close && --depth === 0) return j + 1;
	}
	return s.length;
}

/**
 * Blank out every deferred body inside a literal, so what remains is the data
 * that really is evaluated on load. A property whose value is an arrow or a
 * function expression is deferred, however deeply it is nested.
 */
function stripDeferred(literal: string): string {
	let out = "";
	let i = 0;
	while (i < literal.length) {
		const arrow = literal.indexOf("=>", i);
		const fn = literal.indexOf("function", i);
		const next = arrow === -1 ? fn : fn === -1 ? arrow : Math.min(arrow, fn);
		if (next === -1) return out + literal.slice(i);
		out += literal.slice(i, next);
		// Move past the token, then past whatever body follows it.
		let j = next + (next === arrow ? 2 : "function".length);
		while (j < literal.length && /[\s\w$]/.test(literal[j] ?? "")) j++;
		while (j < literal.length && "({[".includes(literal[j] ?? "")) j = skipBalanced(literal, j);
		if (j <= next) return out; // no progress; stop rather than loop
		// A concise arrow body that is not a bracketed group runs to the next
		// comma at this level; dropping to it is enough for the guard.
		if (j === next + 2) {
			const comma = literal.indexOf(",", j);
			j = comma === -1 ? literal.length : comma;
		}
		i = j;
	}
	return out;
}

export function findFrozenLiterals(src: string): string[] {
	const found: string[] = [];
	for (const start of topLevelDecls(src)) {
		const init = literalInitializer(src, start);
		if (!init) continue;
		if (T_CALL.test(stripDeferred(init))) {
			const name = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)/.exec(
				src.slice(start, start + 120),
			);
			found.push(name?.[1] ?? "<anonymous>");
		}
	}
	return found;
}

describe("t() is never evaluated at module scope", () => {
	const offenders: Array<[string, string[]]> = [];
	for (const rel of new Glob("src/**/*.ts").scanSync(repoRoot)) {
		if (rel.includes("i18n/locale")) continue;
		const names = findFrozenLiterals(readFileSync(join(repoRoot, rel), "utf8"));
		if (names.length > 0) offenders.push([rel, names]);
	}

	test("no top-level object or array literal calls t()", () => {
		expect(offenders).toEqual([]);
	});

	test("the scan catches the shape it exists for", () => {
		const bad = `const TABLE: Record<string, string> = {\n\tnotes: t("Notes"),\n};\n`;
		expect(findFrozenLiterals(bad)).toEqual(["TABLE"]);
	});

	test("a deferred body is not flagged", () => {
		const ok = `const handlers = {\n\tlabel: () => t("Notes"),\n};\n`;
		expect(findFrozenLiterals(ok)).toEqual([]);
	});

	test("a function declaration is not flagged", () => {
		const ok = `function table() {\n\treturn { notes: t("Notes") };\n}\n`;
		expect(findFrozenLiterals(ok)).toEqual([]);
	});

	test("an unrelated call ending in t is not mistaken for t()", () => {
		const ok = `const parts = [\n\tpath.split("/"),\n];\n`;
		expect(findFrozenLiterals(ok)).toEqual([]);
	});
});

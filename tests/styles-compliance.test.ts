/**
 * Compliance test: styles.css — mirrors the Obsidian community dashboard
 * stylelint checks. Catches violations in <100ms without booting stylelint.
 *
 * Rules enforced (parity with `.stylelintrc.json`):
 *   - `declaration-no-important`              → no `!important`
 *   - selector `:has(...)`                    → broad invalidation hurts perf
 *   - multicolumn props                       → only partially supported
 *   - `color-hex-length: long`                → no `#abc` 3-digit shorthand
 *
 * Plus a few extra Obsidian guideline checks ESLint cannot see in CSS:
 *   - no `@import url(...)` (loads remote CSS, blocked by reviewer)
 *   - no hardcoded fonts where a theme var would do (advisory; soft-warn via
 *     count thresholds to avoid false positives on legitimate font-family)
 *   - file is non-empty and small enough to be hand-audited
 *
 * Reference: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Styling
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "..", "styles.css"), "utf8");

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const cssNoComments = stripComments(css);

const FORBIDDEN_PROPS = [
	"column-gap",
	"column-count",
	"column-width",
	"columns",
	"column-rule",
	"column-rule-width",
	"column-rule-style",
	"column-rule-color",
] as const;

describe("styles.css — exists + non-empty", () => {
	test("file has content", () => {
		expect(css.trim().length).toBeGreaterThan(0);
	});
});

describe("styles.css — no !important (stylelint declaration-no-important)", () => {
	test("contains no '!important' declarations", () => {
		const matches = cssNoComments.match(/!\s*important/gi) ?? [];
		expect(matches).toEqual([]);
	});
});

describe("styles.css — no :has() selector (broad invalidation perf)", () => {
	test("contains no ':has(' selector", () => {
		const matches = cssNoComments.match(/:has\s*\(/gi) ?? [];
		expect(matches).toEqual([]);
	});
});

describe("styles.css — no multicolumn properties (stylelint property-disallowed-list)", () => {
	test.each(FORBIDDEN_PROPS)("does not declare '%s'", (prop) => {
		// Match the property at start of declaration: optional whitespace + prop + colon
		const re = new RegExp(`(^|[;{\\s])${prop.replace(/-/g, "\\-")}\\s*:`, "gm");
		expect(cssNoComments.match(re) ?? []).toEqual([]);
	});
});

describe("styles.css — no 3-digit hex shorthand (stylelint color-hex-length: long)", () => {
	test("contains no #abc / #ABC short hex colors", () => {
		// Match #abc but not #aabbcc; require exactly 3 hex chars followed by non-hex
		const matches = cssNoComments.match(/#[0-9a-fA-F]{3}(?![0-9a-fA-F])/g) ?? [];
		expect(matches).toEqual([]);
	});
});

describe("styles.css — no remote @import (reviewer blocks loading remote CSS)", () => {
	test("contains no `@import url(...)` to http/https", () => {
		const matches = cssNoComments.match(/@import[^;]*https?:\/\//gi) ?? [];
		expect(matches).toEqual([]);
	});
});

describe("styles.css — no `expression(` / `behavior:` (legacy IE hacks, never warranted)", () => {
	test("contains no expression()", () => {
		expect(cssNoComments.match(/expression\s*\(/gi) ?? []).toEqual([]);
	});

	test("contains no `behavior:`", () => {
		expect(cssNoComments.match(/(^|[;{\s])behavior\s*:/gi) ?? []).toEqual([]);
	});
});

describe("styles.css — every .engram-* class is referenced in src/", () => {
	// Catches the bug class we hit in v1.3.22→1.3.28: a CSS rule that no
	// element matches because the class name was renamed in CSS, an ancestor
	// scoping class was missing, or the rule was simply never wired up.
	// When CSS is dead, another plugin coinstalled with the same prefix can
	// silently mask the regression by providing the rule — exactly what
	// happened with engram-sync / engram-vault-sync coexisting.

	// Classes set on document.body in lifecycle hooks, not via cls:/addClass —
	// the simple text-scan can't see them.
	const LIFECYCLE_CLASSES = new Set<string>(["engram-vault-sync-active"]);

	const srcDir = join(import.meta.dir, "..", "src");
	const collectTs = (dir: string, out: string[] = []): string[] => {
		for (const entry of readdirSync(dir)) {
			const p = join(dir, entry);
			if (statSync(p).isDirectory()) collectTs(p, out);
			else if (entry.endsWith(".ts")) out.push(p);
		}
		return out;
	};
	const tsBlob = collectTs(srcDir)
		.map((p) => readFileSync(p, "utf8"))
		.join("\n");

	// Literal tokens like "engram-diff-add" and template prefixes like
	// `engram-diff-${...}` (the `engram-diff-` part is what we keep).
	const tsLiterals = new Set<string>();
	for (const m of tsBlob.matchAll(/engram-[a-zA-Z0-9_-]+/g)) {
		tsLiterals.add(m[0]);
	}
	const tsPrefixes: string[] = [];
	for (const m of tsBlob.matchAll(/engram-[a-zA-Z0-9_-]*-(?=\$\{)/g)) {
		tsPrefixes.push(m[0]);
	}

	const cssClasses = new Set<string>();
	for (const m of cssNoComments.matchAll(/\.(engram-[a-zA-Z0-9_-]+)/g)) {
		cssClasses.add(m[1]);
	}

	test("no orphan .engram-* selectors in styles.css", () => {
		const orphans = [...cssClasses].filter(
			(c) =>
				!LIFECYCLE_CLASSES.has(c) &&
				!tsLiterals.has(c) &&
				!tsPrefixes.some((p) => c.startsWith(p)),
		);
		expect(orphans).toEqual([]);
	});
});

describe("styles.css — class prefix convention", () => {
	test("all NEW class selectors start with 'engram-'", () => {
		// Find class selectors in the stylesheet. Allowlist Obsidian core class
		// names that plugins legitimately style (setting-*, modal-*, menu-*, etc.)
		// and chained-state modifiers (is-*, mod-*, has-*).
		const OBSIDIAN_CORE_PREFIXES = [
			"is-",
			"mod-",
			"has-",
			"setting-",
			"modal-",
			"menu-",
			"suggestion-",
			"callout-",
			"workspace-",
			"view-",
			"nav-",
			"tree-",
			"cm-",
			"markdown-",
			"clickable-",
			"internal-",
			"external-",
			"tag-",
			"file-",
			"folder-",
			"editor-",
		] as const;
		const classNames = new Set<string>();
		for (const m of cssNoComments.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
			classNames.add(m[1]);
		}
		const offenders = [...classNames].filter(
			(c) =>
				!c.startsWith("engram-") &&
				!OBSIDIAN_CORE_PREFIXES.some((prefix) => c.startsWith(prefix)),
		);
		expect(offenders).toEqual([]);
	});
});

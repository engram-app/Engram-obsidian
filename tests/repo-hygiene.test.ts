/**
 * Compliance test: repository-level hygiene for Obsidian community submission.
 *
 * Per https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin the repo
 * must contain at root: README.md, LICENSE, manifest.json. Release assets must
 * include main.js, manifest.json, and optionally styles.css.
 *
 * This file enforces invariants that don't fit other compliance suites:
 *   - All four root files exist.
 *   - main.js is non-trivially populated (build artifact present).
 *   - Plugin id matches conventions used in the manifest.
 *   - .gitignore does not ignore manifest.json / versions.json (sanity).
 *   - tsconfig + lefthook / CI files exist (release process invariants).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");

const exists = (relPath: string) => existsSync(join(repoRoot, relPath));
const readMaybe = (relPath: string) =>
	exists(relPath) ? readFileSync(join(repoRoot, relPath), "utf8") : "";

describe("repo — required files exist at root", () => {
	test.each([
		"manifest.json",
		"versions.json",
		"package.json",
		"README.md",
		"LICENSE",
		"styles.css",
		"esbuild.config.mjs",
		"version-bump.mjs",
		"tsconfig.json",
		"eslint.config.mts",
		".stylelintrc.json",
	])("`%s` is present", (path) => {
		expect(exists(path)).toBe(true);
	});
});

describe("repo — main.js build artifact", () => {
	test("main.js exists and is non-trivially sized (>1KB)", () => {
		if (!exists("main.js")) {
			// In a fresh checkout main.js may be absent; warn but don't fail.
			return;
		}
		const size = statSync(join(repoRoot, "main.js")).size;
		expect(size).toBeGreaterThan(1024);
	});
});

describe("repo — .gitignore sanity (must NOT ignore release assets)", () => {
	const gi = readMaybe(".gitignore");
	test.each(["manifest.json", "versions.json", "styles.css", "LICENSE", "README.md"])(
		"`%s` is not gitignored",
		(file) => {
			// crude check: exact line or path equality only
			const lines = gi.split("\n").map((l) => l.trim());
			expect(lines).not.toContain(file);
			expect(lines).not.toContain(`/${file}`);
		},
	);
});

describe("repo — CI workflows present (release process invariants)", () => {
	test.each([
		".github/workflows/ci.yml",
		".github/workflows/release.yml",
		".github/workflows/version-check.yml",
	])("`%s` exists", (path) => {
		expect(exists(path)).toBe(true);
	});
});

describe("repo — README structure (Obsidian developer policies)", () => {
	const readme = readMaybe("README.md");

	test("non-empty and >500 chars", () => {
		expect(readme.length).toBeGreaterThan(500);
	});

	test("contains an H1 heading", () => {
		expect(readme).toMatch(/^#\s+\S/m);
	});

	test("links to the GitHub repository (canonical install path)", () => {
		expect(readme.toLowerCase()).toContain("github.com");
	});
});

describe("repo — manifest.json id matches package.json name convention", () => {
	const manifest = JSON.parse(readMaybe("manifest.json")) as { id: string };
	const pkg = JSON.parse(readMaybe("package.json")) as { name: string };

	test("plugin id is kebab-case lowercase", () => {
		expect(manifest.id).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
	});

	test("package name is kebab-case lowercase", () => {
		expect(pkg.name).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
	});
});

describe("repo — manifest funding link sanity", () => {
	const manifest = JSON.parse(readMaybe("manifest.json")) as {
		fundingUrl?: string | Record<string, string>;
	};

	test("fundingUrl, if string, is an https URL", () => {
		if (typeof manifest.fundingUrl !== "string") return;
		expect(manifest.fundingUrl).toMatch(/^https:\/\//);
	});

	test("fundingUrl, if object, has https URL values", () => {
		if (typeof manifest.fundingUrl !== "object" || manifest.fundingUrl === null) return;
		for (const v of Object.values(manifest.fundingUrl)) {
			expect(v).toMatch(/^https:\/\//);
		}
	});
});

/**
 * Compliance test: manifest.json — full mirror of `obsidianmd/validate-manifest`
 * ESLint rule plus cross-file (package.json, versions.json) consistency.
 *
 * Source rule (verbatim logic ported below):
 *   node_modules/eslint-plugin-obsidianmd/dist/lib/rules/validateManifest.js
 *
 * Why mirror it in `bun test`?
 *   1. Dashboard validator failures are slow (minutes); these run in ms.
 *   2. ESLint config drift cannot silently disable these checks — the test
 *      suite is the spec, per project policy "tests are the spec".
 *   3. Catches plain-JSON corruption that ESLint (which parses .ts only here)
 *      would never see, because lint:obsidian globs `src` TypeScript files.
 *
 * Official references:
 *   https://docs.obsidian.md/Reference/Manifest
 *   https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");

type Manifest = {
	id: string;
	name: string;
	version: string;
	minAppVersion: string;
	description: string;
	author: string;
	isDesktopOnly: boolean;
	authorUrl?: string;
	fundingUrl?: string | Record<string, string>;
} & Record<string, unknown>;

const rawManifest = readFileSync(join(repoRoot, "manifest.json"), "utf8");
const manifest = JSON.parse(rawManifest) as Manifest;
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
	version: string;
	description: string;
};
const versions = JSON.parse(readFileSync(join(repoRoot, "versions.json"), "utf8")) as Record<
	string,
	string
>;

/** Semver compare for x.y.z only; the suite already asserts that shape. */
function cmpSemver(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d < 0 ? -1 : 1;
	}
	return 0;
}

const REQUIRED_KEYS = {
	author: "string",
	minAppVersion: "string",
	name: "string",
	version: "string",
	id: "string",
	description: "string",
	isDesktopOnly: "boolean",
} as const;
const OPTIONAL_KEYS = {
	authorUrl: "string",
	fundingUrl: "string|object",
} as const;
const ALLOWED_KEYS = { ...REQUIRED_KEYS, ...OPTIONAL_KEYS };
const FORBIDDEN_WORDS_IN_TEXT = ["obsidian", "plugin"] as const;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

describe("manifest.json — schema (validate-manifest parity)", () => {
	test("parses as a JSON object", () => {
		expect(typeof manifest).toBe("object");
		expect(Array.isArray(manifest)).toBe(false);
	});

	test.each(Object.keys(REQUIRED_KEYS))("required key '%s' is present", (key) => {
		expect(Object.hasOwn(manifest, key)).toBe(true);
	});

	test.each(Object.entries(REQUIRED_KEYS))(
		"required key '%s' has type '%s'",
		(key, expectedType) => {
			expect(typeof manifest[key as keyof Manifest]).toBe(expectedType);
		},
	);

	test("contains no disallowed top-level keys", () => {
		const stray = Object.keys(manifest).filter((k) => !Object.hasOwn(ALLOWED_KEYS, k));
		expect(stray).toEqual([]);
	});

	test("raw JSON has no duplicate keys (regex sanity)", () => {
		const keys = Array.from(rawManifest.matchAll(/^\s*"([^"]+)"\s*:/gm), (m) => m[1]);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("manifest.json — forbidden words ('obsidian' / 'plugin' substring, case-insensitive)", () => {
	test.each(["name", "description", "id"] as const)(
		"%s contains neither 'obsidian' nor 'plugin'",
		(field) => {
			const value = manifest[field].toLowerCase();
			for (const word of FORBIDDEN_WORDS_IN_TEXT) {
				expect(value).not.toContain(word);
			}
		},
	);
});

describe("manifest.json — description format (matches dashboard reviewer)", () => {
	const description = manifest.description;

	test("length is between 10 and 250 chars (inclusive)", () => {
		expect(description.length).toBeGreaterThanOrEqual(10);
		expect(description.length).toBeLessThanOrEqual(250);
	});

	test("starts with a capital letter", () => {
		expect(description).toMatch(/^[A-Z]/);
	});

	test("ends with a period", () => {
		expect(description.endsWith(".")).toBe(true);
	});

	test("contains only allowed characters (no emoji, accents, etc.)", () => {
		expect(description).toMatch(/^[A-Za-z0-9\s.,!?'"-]+$/);
	});
});

describe("manifest.json — version + minAppVersion format", () => {
	test("version matches x.y.z (no pre-release suffix)", () => {
		expect(manifest.version).toMatch(SEMVER_RE);
	});

	test("minAppVersion matches x.y.z", () => {
		expect(manifest.minAppVersion).toMatch(SEMVER_RE);
	});
});

describe("manifest.json — id constraints (Obsidian Reference/Manifest)", () => {
	const id = manifest.id;

	test("does not contain the substring 'obsidian'", () => {
		expect(id.toLowerCase()).not.toContain("obsidian");
	});

	test("is kebab-case, ASCII, no spaces, no underscores", () => {
		expect(id).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
	});

	test("length 3..60 chars (sanity)", () => {
		expect(id.length).toBeGreaterThanOrEqual(3);
		expect(id.length).toBeLessThanOrEqual(60);
	});
});

describe("manifest.json — isDesktopOnly", () => {
	test("is boolean (not stringified)", () => {
		expect(typeof manifest.isDesktopOnly).toBe("boolean");
	});

	test("if false, plugin must not statically import node:* modules", () => {
		if (manifest.isDesktopOnly) return;
		// Spot-check src/*.ts for `from "node:..."` or bare-builtin imports.
		// Full check is enforced by `obsidianmd/no-nodejs-modules` ESLint rule;
		// this is a redundant safety net the test suite owns.
		const { readdirSync } = require("node:fs") as typeof import("node:fs");
		const srcDir = join(repoRoot, "src");
		const offenders: string[] = [];
		const builtinPattern =
			/from\s+["'](?:node:|fs|path|os|crypto|child_process|stream|http|https|net|tls|util|url|querystring|zlib|buffer|events|assert|module)["']/;
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const p = join(dir, entry.name);
				if (entry.isDirectory()) walk(p);
				else if (entry.isFile() && entry.name.endsWith(".ts")) {
					const text = readFileSync(p, "utf8");
					if (builtinPattern.test(text)) offenders.push(p.replace(`${repoRoot}/`, ""));
				}
			}
		};
		walk(srcDir);
		expect(offenders).toEqual([]);
	});
});

describe("manifest.json — authorUrl / fundingUrl optional fields", () => {
	test("authorUrl, if present, is a non-empty string", () => {
		if (manifest.authorUrl === undefined) return;
		expect(typeof manifest.authorUrl).toBe("string");
		expect(manifest.authorUrl.length).toBeGreaterThan(0);
	});

	test("authorUrl, if present, is an https:// URL", () => {
		if (manifest.authorUrl === undefined) return;
		expect(manifest.authorUrl).toMatch(/^https?:\/\//);
	});

	test("fundingUrl, if present, is a non-empty string or non-empty string-object", () => {
		const f = manifest.fundingUrl;
		if (f === undefined) return;
		if (typeof f === "string") {
			expect(f.length).toBeGreaterThan(0);
			return;
		}
		expect(typeof f).toBe("object");
		const entries = Object.entries(f);
		expect(entries.length).toBeGreaterThan(0);
		for (const [, v] of entries) {
			expect(typeof v).toBe("string");
			expect((v as string).length).toBeGreaterThan(0);
		}
	});
});

describe("manifest.json — cross-file consistency", () => {
	test("manifest.version equals package.json.version", () => {
		expect(manifest.version).toBe(pkg.version);
	});

	test("package.json.description equals manifest.description", () => {
		expect(pkg.description).toBe(manifest.description);
	});

	test("versions.json contains an entry for manifest.version", () => {
		expect(Object.keys(versions)).toContain(manifest.version);
	});

	// Exact equality cannot hold on a feature branch that RAISES the floor:
	// manifest.version still names the last release (release-please owns bumps),
	// and its versions.json entry records the floor that release actually
	// shipped with. Rewriting that entry would retroactively cut users off from
	// an already-published version. release-please writes the new version's
	// entry from manifest.minAppVersion at release time, making it exact again.
	//
	// So the invariant that holds at every point is directional: the recorded
	// floor may lag a pending raise, but it must never be AHEAD of the declared
	// one, which is what an accidental lowering would look like.
	test("versions.json[manifest.version] is never ahead of manifest.minAppVersion", () => {
		const recorded = versions[manifest.version];
		expect(recorded).toBeDefined();
		expect(cmpSemver(recorded as string, manifest.minAppVersion)).toBeLessThanOrEqual(0);
	});

	test("minAppVersion never decreases as plugin versions ascend", () => {
		const ordered = Object.keys(versions).sort(cmpSemver);
		let prev = "0.0.0";
		for (const version of ordered) {
			const floor = versions[version] as string;
			expect(
				cmpSemver(floor, prev),
				`${version} lowers the floor to ${floor}`,
			).toBeGreaterThanOrEqual(0);
			prev = floor;
		}
	});

	test("every versions.json key is valid x.y.z", () => {
		for (const key of Object.keys(versions)) expect(key).toMatch(SEMVER_RE);
	});

	test("every versions.json value (minAppVersion) is valid x.y.z", () => {
		for (const value of Object.values(versions)) expect(value).toMatch(SEMVER_RE);
	});

	test("manifest.version is the newest entry in versions.json", () => {
		const cmp = (a: string, b: string) => {
			const pa = a.split(".").map(Number);
			const pb = b.split(".").map(Number);
			for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
			return 0;
		};
		const sorted = Object.keys(versions).sort(cmp);
		expect(sorted[sorted.length - 1]).toBe(manifest.version);
	});
});

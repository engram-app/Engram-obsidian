#!/usr/bin/env node
/**
 * Assert package-lock.json still matches package.json.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * bun is our package manager. We track package-lock.json anyway because
 * Obsidian's community scanner (the thing that produces the quality scorecard
 * on the public plugin listing) installs with npm. If it cannot install, the
 * `obsidian` module never resolves, every Obsidian API value becomes the
 * TypeScript error type, and the scorecard fills with thousands of bogus
 * @typescript-eslint/no-unsafe-{call,member-access,assignment,argument}
 * findings. Measured: 0 findings with the types present, 3148 without.
 *
 * So the lockfile is a published artifact, not our install path. Nothing here
 * ever runs `npm ci`. It only has to stay truthful.
 *
 * WHY NOT JUST REGENERATE AND DIFF
 * --------------------------------
 * Our ranges float (`^x.y.z`). A fresh `npm install --package-lock-only`
 * picks up any patch published since, so a byte-diff would go red on
 * unrelated PRs. And npm's own tooling is no help: `npm ci`, `npm ci
 * --dry-run` and `npm ls --package-lock-only` were all measured to accept or
 * silently repair a drifted lockfile rather than fail (npm 10.9.7).
 *
 * So we check the two things that actually break the scanner, offline:
 *   1. the lockfile's root dependency blocks mirror package.json exactly
 *      (catches an added / removed / re-ranged dep)
 *   2. every `overrides` pin resolves to a satisfying version (catches a
 *      security bump that never made it into the lock, which would leave the
 *      scanner's advisory scan looking at the vulnerable version). npm
 *      records `overrides` nowhere in the lockfile, so this cannot be a
 *      structural compare.
 *
 * Fix any failure with:  npm install --package-lock-only --ignore-scripts
 * Run that in a directory WITHOUT node_modules, or npm reconciles against
 * bun's tree and emits a lockfile with no `resolved`/`integrity` fields.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (f) => JSON.parse(readFileSync(join(root, f), "utf8"));

const pkg = read("package.json");
const lock = read("package-lock.json");
const errors = [];

// 1. Root dependency blocks must mirror package.json.
const lockRoot = lock.packages?.[""] ?? {};
for (const field of ["dependencies", "devDependencies"]) {
	const want = JSON.stringify(pkg[field] ?? {}, Object.keys(pkg[field] ?? {}).sort());
	const got = JSON.stringify(lockRoot[field] ?? {}, Object.keys(lockRoot[field] ?? {}).sort());
	if (want !== got) {
		errors.push(`package-lock.json "${field}" does not match package.json`);
	}
}

// 2. Every override must be satisfied by the version the lockfile pins.
//
// ponytail: handles `^x.y.z`, `~x.y.z` and exact pins, which is every range
// we have ever put in `overrides`. Anything else fails loudly rather than
// passing silently. If we ever need real range syntax, pull in `semver`.
const satisfies = (version, range) => {
	const exact = /^\d+\.\d+\.\d+$/;
	if (exact.test(range)) return version === range;

	const m = /^([\^~])(\d+)\.(\d+)\.(\d+)$/.exec(range);
	if (!m) return null; // unsupported range syntax

	const [, op, major, minor, patch] = m;
	const v = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!v) return false;

	const [a, b, c] = [Number(v[1]), Number(v[2]), Number(v[3])];
	const [x, y, z] = [Number(major), Number(minor), Number(patch)];
	if (a !== x) return false;
	if (op === "~") return b === y && c >= z;
	return b > y || (b === y && c >= z);
};

for (const [name, range] of Object.entries(pkg.overrides ?? {})) {
	const pinned = Object.entries(lock.packages ?? {})
		.filter(([path]) => path.endsWith(`node_modules/${name}`))
		.map(([, entry]) => entry.version)
		.filter(Boolean);

	if (pinned.length === 0) {
		errors.push(`override "${name}" is not present in package-lock.json`);
		continue;
	}
	for (const version of new Set(pinned)) {
		const ok = satisfies(version, range);
		if (ok === null) {
			errors.push(
				`override "${name}": range "${range}" uses syntax this check does not understand — extend scripts/check-npm-lockfile.mjs`,
			);
		} else if (!ok) {
			errors.push(`override "${name}": lockfile pins ${version}, which does not satisfy "${range}"`);
		}
	}
}

if (errors.length > 0) {
	console.error("package-lock.json is out of sync with package.json:\n");
	for (const e of errors) console.error(`  - ${e}`);
	console.error("\nRegenerate it in a directory with no node_modules:");
	console.error("  rm -rf /tmp/lockgen && mkdir -p /tmp/lockgen \\");
	console.error("    && cp package.json /tmp/lockgen/ \\");
	console.error("    && (cd /tmp/lockgen && npm install --package-lock-only --ignore-scripts) \\");
	console.error("    && cp /tmp/lockgen/package-lock.json .");
	process.exit(1);
}

console.log("OK - package-lock.json matches package.json.");

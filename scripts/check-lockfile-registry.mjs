#!/usr/bin/env node
/**
 * Assert no tracked lockfile points at a private registry.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Our machines and self-hosted CI runners set
 * `registry=http://10.0.20.214:4873` (the LAN Verdaccio proxy) in ~/.npmrc.
 * Both bun and npm bake that host into every tarball URL they write into a
 * lockfile. The result installs fine for us and is unusable for everyone
 * else, because 10.0.0.0/8 is not routable from outside our LAN:
 *
 *   - this repo is PUBLIC, so a drive-by contributor running `bun install`
 *     fails on all 481 packages with no obvious cause
 *   - Obsidian's community scanner, which produces the quality scorecard on
 *     our public plugin listing, installs in its own sandbox. When it cannot
 *     install, the `obsidian` module never resolves, every Obsidian API value
 *     becomes the TypeScript error type, and the scorecard fills with
 *     thousands of bogus @typescript-eslint/no-unsafe-* findings. Measured on
 *     this repo: 0 findings with the types present, 3148 without.
 *
 * That second one already cost us two months. PR #125 (2026-05) committed a
 * package-lock.json to fix the scorecard, saw no change, and concluded "the
 * audit ignores package-lock.json". But that lockfile had 466 of 466 tarballs
 * on 10.0.20.214:4873, so npm could not fetch a single one. A negative result
 * from a silently invalid artifact is worse than no result: it gets written
 * into a commit message as settled fact and closes off the right hypothesis.
 * This check exists so that cannot happen a third time.
 *
 * FIXING A FAILURE
 * ----------------
 * Make sure no registry is configured (`npm config get registry` should say
 * registry.npmjs.org, and ~/.npmrc should have no bare `registry=` line),
 * then delete the lockfile and reinstall:
 *
 *   rm bun.lock && bun install
 *
 * bun writes no tarball URL at all when the default registry is in use, so a
 * correct lockfile has an empty registry field: ["pkg@1.2.3", "", {...}].
 *
 * Deleting it first is required, not tidiness. Measured on bun 1.3.11: bun
 * honours the URL baked into the lockfile over .npmrc, bunfig.toml, the
 * environment, AND the --registry flag, so a poisoned lockfile cannot be
 * repaired by configuration. Note this re-resolves floating ranges, so expect
 * transitive version drift and run the full suite.
 *
 * ponytail: greps for private hosts rather than parsing each file format.
 * bun.lock is JSONC, package-lock.json is JSON, .npmrc is ini, so a shared
 * parser would be more code for no more safety. Switch to parsing if we ever
 * need per-package detail beyond "which line".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Lockfiles carry the symptom; .npmrc and bunfig.toml carry the cause. A
// committed `registry=http://10.0.20.214:4873` would re-poison the lockfile on
// the next resolve and break every outside contributor, so check both.
// package-lock.json is optional: only tracked if something external (the
// Obsidian scanner) turns out to need an npm install path.
//
// yarn.lock and pnpm-lock.yaml are deliberately absent. Nothing in this repo
// produces them and CLAUDE.md mandates bun.
const FILES = ["bun.lock", "package-lock.json", ".npmrc", "bunfig.toml"];

// RFC1918 plus loopback, anchored to a URL host position.
//
// The `://` anchor is load-bearing: matching a bare token made this fire on
// any package NAMED after a host (`is-localhost-ip` and `localhost` are real
// npm packages, and `-` counts as a word boundary) and on 4-segment version
// strings like 10.0.20.1. The failure mode being guarded against is always a
// URL host, never a bare token, so anchoring loses no coverage.
const PRIVATE_HOST =
	/:\/\/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost)\b/;

const errors = [];
const checked = [];

for (const name of FILES) {
	let content;
	try {
		content = readFileSync(join(root, name), "utf8");
	} catch (err) {
		if (err.code === "ENOENT") continue; // not tracked in this repo
		throw err;
	}
	checked.push(name);

	const hits = content
		.split("\n")
		.map((text, i) => ({ line: i + 1, text }))
		.filter(({ text }) => PRIVATE_HOST.test(text));

	if (hits.length > 0) {
		const first = hits[0];
		const host = PRIVATE_HOST.exec(first.text)?.[0].replace("://", "");
		errors.push(
			`${name}: ${hits.length} line(s) reference the private host "${host}" (first at ${name}:${first.line})`,
		);
	}
}

// bun.lock is always tracked here, so its absence means someone deleted it or
// moved this script, not that the repo legitimately has no lockfile.
if (!checked.includes("bun.lock")) {
	console.error("bun.lock not found. Expected it at the repo root, next to package.json.");
	process.exit(1);
}

if (errors.length > 0) {
	console.error("Lockfile points at a private registry, unusable outside our LAN:\n");
	for (const e of errors) console.error(`  - ${e}`);
	console.error("\nEnsure no registry is configured, then delete the lockfile and reinstall:");
	console.error("  rm bun.lock && bun install");
	console.error("\nDeleting it first is required: bun honours the URL in the lockfile over");
	console.error("--registry, .npmrc, bunfig.toml and the environment.");
	process.exit(1);
}

console.log(`OK - no private-registry hosts in: ${checked.join(", ")}`);

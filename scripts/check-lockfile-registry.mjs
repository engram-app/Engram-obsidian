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
 * audit ignores package-lock.json" — but that lockfile had 466 of 466
 * tarballs on 10.0.20.214:4873, so npm could not fetch a single one. A
 * negative result from a silently invalid artifact is worse than no result.
 * This check exists so that cannot happen a third time.
 *
 * FIXING A FAILURE
 * ----------------
 * The URL path layout is identical (Verdaccio mirrors npm's), and integrity
 * hashes are content-based, so a plain rewrite is correct and preserves the
 * exact resolved versions:
 *
 *   sed -i 's|http://10.0.20.214:4873/|https://registry.npmjs.org/|g' bun.lock
 *
 * Do NOT try to fix this with `bun install --registry=...`. Measured: bun
 * honours the URL baked into the lockfile over .npmrc, bunfig.toml, the
 * environment, AND the --registry flag. A lockfile written on a LAN machine
 * stays poisoned until the URLs are rewritten.
 *
 * ponytail: greps for private hosts rather than parsing each lockfile format.
 * bun.lock is JSONC and package-lock.json is JSON, so a shared parser would
 * be more code for no more safety. Switch to parsing if we ever need
 * per-package detail beyond "which line".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// package-lock.json is optional here: it is only tracked if something
// external (the Obsidian scanner) turns out to need an npm install path.
const LOCKFILES = ["bun.lock", "package-lock.json"];

// RFC1918 plus loopback. Anything here is unreachable from outside our LAN.
const PRIVATE_HOST =
	/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost)\b/;

const errors = [];
let checked = 0;

for (const name of LOCKFILES) {
	let content;
	try {
		content = readFileSync(join(root, name), "utf8");
	} catch (err) {
		if (err.code === "ENOENT") continue; // not tracked in this repo
		throw err;
	}
	checked++;

	const hits = content
		.split("\n")
		.map((text, i) => ({ line: i + 1, text }))
		.filter(({ text }) => PRIVATE_HOST.test(text));

	if (hits.length > 0) {
		const first = hits[0];
		const host = PRIVATE_HOST.exec(first.text)?.[0];
		errors.push(
			`${name}: ${hits.length} line(s) reference the private host "${host}" (first at ${name}:${first.line})`,
		);
	}
}

if (checked === 0) {
	console.error("No lockfile found. Expected at least one of:", LOCKFILES.join(", "));
	process.exit(1);
}

if (errors.length > 0) {
	console.error("Lockfile points at a private registry, unusable outside our LAN:\n");
	for (const e of errors) console.error(`  - ${e}`);
	console.error("\nRewrite the URLs (preserves versions and integrity hashes):");
	console.error("  sed -i 's|http://10.0.20.214:4873/|https://registry.npmjs.org/|g' bun.lock");
	console.error("\nSee the header of scripts/check-lockfile-registry.mjs for why");
	console.error("`bun install --registry=...` does NOT fix this.");
	process.exit(1);
}

console.log(`OK - ${checked} lockfile(s) resolve from public registries.`);

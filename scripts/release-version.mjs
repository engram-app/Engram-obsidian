// Pure version-derivation for the release channels. No deps. See plan Task 1.
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function nextPatch(stable) {
	const m = SEMVER.exec(stable);
	if (!m) throw new Error(`not a plain semver: ${stable}`);
	const [, major, minor, patch] = m;
	return `${major}.${minor}.${Number(patch) + 1}`;
}

export function betaVersion(stable, n) {
	return `${nextPatch(stable)}-beta.${n}`;
}

export function prVersion(stable, prNum, shortSha) {
	return `${nextPatch(stable)}-pr.${prNum}.${shortSha}`;
}

// CLI shim so workflows can call it without a bundler:
//   bun run scripts/release-version.mjs beta  1.12.26 3        -> 1.12.27-beta.3
//   bun run scripts/release-version.mjs pr    1.12.26 42 a1b2c3d
//   bun run scripts/release-version.mjs patch 1.12.26
if (import.meta.main) {
	const [mode, stable, a, b] = process.argv.slice(2);
	const out =
		mode === "beta"
			? betaVersion(stable, Number(a))
			: mode === "pr"
				? prVersion(stable, Number(a), b)
				: mode === "patch"
					? nextPatch(stable)
					: (() => {
							throw new Error(`unknown mode: ${mode}`);
						})();
	process.stdout.write(out);
}

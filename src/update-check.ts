import { requestUrl } from "obsidian";

/** Raw manifest on the default branch — the same file Obsidian's own community
 *  updater reads to detect the latest version. No auth, works on mobile. */
export const MANIFEST_URL =
	"https://raw.githubusercontent.com/engram-app/Engram-obsidian/master/manifest.json";

/** GitHub Releases page users land on to grab the update. */
export const RELEASES_URL = "https://github.com/engram-app/Engram-obsidian/releases/latest";

/** True when `latest` is a strictly higher version than `current`.
 *  ponytail: numeric dot-triple only (our tags are clean, e.g. 1.12.17).
 *  If we ever ship pre-release suffixes (1.13.0-beta.1), swap in a semver lib. */
export function isNewerVersion(latest: string, current: string): boolean {
	const a = latest.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const b = current.split(".").map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);
		if (diff !== 0) return diff > 0;
	}
	return false;
}

/** Fetch the published manifest and return the newer version string, or null
 *  if up to date / unreachable. Never throws — an update nudge must not be able
 *  to disrupt plugin load. */
export async function checkForPluginUpdate(currentVersion: string): Promise<string | null> {
	try {
		const resp = await requestUrl({ url: MANIFEST_URL, method: "GET", throw: false });
		if (resp.status !== 200) return null;
		const latest = (resp.json as { version?: unknown } | undefined)?.version;
		return typeof latest === "string" && isNewerVersion(latest, currentVersion) ? latest : null;
	} catch {
		return null;
	}
}

import { Platform } from "obsidian";

/**
 * A name for this device, sent when the link starts so the web page can offer
 * it as the connection's default label. Best effort: the user can edit or clear
 * it on /link, and `undefined` means we have nothing useful to suggest.
 *
 * Desktop uses the machine hostname (Node's `os` is desktop-only, so it is
 * loaded lazily behind the platform check and never touched on mobile). Mobile
 * has no hostname API and Obsidian exposes no model, only the platform.
 */
export async function suggestDeviceName(): Promise<string | undefined> {
	if (Platform.isDesktop) {
		try {
			const { hostname } = await import("node:os");
			const name = hostname()
				.trim()
				.replace(/\.local$/iu, "");
			if (name) {
				return name;
			}
		} catch {
			// Fall through to the platform name below.
		}
	}
	if (Platform.isIosApp) {
		return Platform.isTablet ? "iPad" : "iPhone";
	}
	if (Platform.isAndroidApp) {
		return Platform.isTablet ? "Android tablet" : "Android phone";
	}
	if (Platform.isMacOS) {
		return "Mac";
	}
	if (Platform.isWin) {
		return "Windows PC";
	}
	if (Platform.isLinux) {
		return "Linux PC";
	}
	return undefined;
}

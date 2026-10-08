import { Platform } from "obsidian";
import { devLog } from "./dev-log";
import { errMsg } from "./error-util";

/** The backend drops a suggestion longer than this. */
const MAX_NAME_CHARS = 64;

/**
 * The part of a hostname worth showing. Keeps only the first label, so
 * "Todds-MacBook.local" and "wks-123.corp.example.com" do not ship a domain,
 * and drops placeholders that cannot tell two machines apart ("localhost").
 */
export function cleanHostname(raw: string): string | undefined {
	const first = raw.trim().split(".")[0]?.trim() ?? "";
	if (!first || first.toLowerCase() === "localhost" || first.length > MAX_NAME_CHARS) {
		return undefined;
	}
	return first;
}

/**
 * A name for this device, sent when the link starts so the web page can offer
 * it as the connection's default label. Best effort: the user can edit or clear
 * it on /link, and `undefined` means we have nothing useful to suggest.
 *
 * Desktop uses the machine hostname (Node's `os` is desktop-only, so it is
 * loaded lazily behind the platform check and never touched on mobile). Mobile
 * has no hostname API and Obsidian exposes no model, only the platform.
 */
export async function suggestDeviceName(
	readHostname?: () => Promise<string>,
): Promise<string | undefined> {
	if (Platform.isDesktop) {
		try {
			// `os` is desktop-only, so it is imported here, behind the check, and
			// never on mobile. Tests inject a reader instead of mocking the module.
			const raw = readHostname ? await readHostname() : (await import("node:os")).hostname();
			const name = cleanHostname(raw);
			if (name) {
				return name;
			}
		} catch (e) {
			// A best-effort hint must not fail the link; fall through to the
			// platform name below.
			devLog().log("device-flow", `hostname unavailable: ${errMsg(e)}`);
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

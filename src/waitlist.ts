import { requestUrl } from "obsidian";
import { withTimeout } from "./api";

/** The MARKETING site endpoint (engram.page), not the sync backend
 *  (api.engram.page). Hardcoded: it's a fixed public URL, independent of the
 *  user's configured apiUrl, and is reached before any auth exists. */
export const WAITLIST_ENDPOINT = "https://engram.page/api/waitlist";

/** Add an email to the launch waitlist. Tokenless — the user is not
 *  authenticated. Throws on non-2xx or transport error so the modal can show
 *  an inline message; dismissal is independent of this succeeding. */
export async function submitWaitlistEmail(email: string): Promise<void> {
	const resp = await withTimeout(
		requestUrl({
			url: WAITLIST_ENDPOINT,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email, source: "obsidian-plugin" }),
			throw: false,
		}),
		15_000,
	);
	if (resp.status < 200 || resp.status >= 300) {
		throw new Error(`waitlist signup failed: ${resp.status}`);
	}
}

/** Returns true when the first-run waitlist popup should be shown.
 *  False once the user has submitted or dismissed it (flag is truthy). */
export function shouldShowWaitlistPrompt(settings: { waitlistPromptSeen?: boolean }): boolean {
	return settings.waitlistPromptSeen !== true;
}

/**
 * The one place a caught error becomes text a user reads.
 *
 * `Error.message` is developer English (often the server's), so showing it
 * ships English to every locale and can leak a vault path. Callers keep the raw
 * message for their logs and show this instead. Classification is by error
 * class or HTTP status, never by matching message text; anything unrecognised
 * gets a translated generic sentence. The lint gate in
 * scripts/eslint-i18n-sinks.ts rejects `.message` / `errMsg()` in UI sinks.
 */
import { RequestTimeoutError } from "../api";
import { NotAuthenticatedError, statusOf } from "../error-util";
import { toastFor } from "../limit-copy";
import { LimitExceededError } from "../limit-error";
import type { ParseReason } from "../types";
import { t } from ".";

export function userErrorMessage(e: unknown): string {
	if (e instanceof LimitExceededError) return toastFor(e.reason);
	if (e instanceof RequestTimeoutError)
		return t("The server took too long to respond. Try again.");
	const status = statusOf(e);
	// Keys are literal on purpose: src/i18n/keys-scan.ts only sees `t("...")`.
	if (e instanceof NotAuthenticatedError || status === 401 || status === 403)
		return t("Not signed in, or the session expired. Sign in again in Engram settings.");
	if (status === 413) return t("The file is too large for the server.");
	if (status === 429) return t("Too many requests. Wait a moment and try again.");
	if (status !== undefined && status >= 500)
		return t("Server error ({status}) — check Engram logs", { status });
	if (status !== undefined && status >= 400) return t("Request failed ({status})", { status });
	// Status-less transport failures: fetch rejects with a TypeError, Electron's
	// net stack (behind requestUrl) with a `net::ERR_*` code.
	if (e instanceof TypeError || (e instanceof Error && e.message.startsWith("net::")))
		return t("Could not reach Engram — check connection");
	return t("Unknown error");
}

/** A backend `parse_reason`, by its code. The backend's `message` is English. */
export function parseReasonMessage(reason: ParseReason): string {
	switch (reason.code) {
		case "frontmatter_invalid_yaml":
			return t("Frontmatter isn't valid YAML.");
		case "frontmatter_unparseable_key":
			return reason.detail?.key
				? t('Frontmatter key "{key}" could not be parsed as YAML.', {
						key: reason.detail.key,
					})
				: t("A frontmatter key could not be parsed as YAML.");
		case "note_processing_failed":
			return t("This note could not be processed and was skipped.");
		default:
			return t("Frontmatter could not be parsed");
	}
}

/**
 * legal-notices.ts — pending legal changes from `GET /api/onboarding/status`.
 *
 * The backend emails every user and the web app shows a banner; this is the
 * Obsidian-side copy for people who live in the plugin. A notice-only change
 * is shown once per version. A material change is shown on every check until
 * it is accepted, because using Engram past its date requires acceptance.
 * Pure on purpose so the unit suite can test it without Obsidian.
 */
import { t } from "./i18n";

/** One entry of `legal_notices` on the wire. */
export interface LegalNotice {
	document: "terms_of_service" | "privacy_policy";
	version: string;
	/** ISO date (YYYY-MM-DD), always in the future while the notice exists. */
	effective_date: string;
	material: boolean;
	changelog: string | null;
	url: string;
	accept_url: string;
}

export function noticeKey(n: LegalNotice): string {
	return `${n.document}@${n.version}`;
}

export function noticesToShow(notices: LegalNotice[], seen: readonly string[]): LegalNotice[] {
	return notices.filter((n) => n.material || !seen.includes(noticeKey(n)));
}

export function noticeText(n: LegalNotice, locale: string): string {
	const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
		new Date(`${n.effective_date}T00:00:00Z`),
	);
	const doc = n.document === "terms_of_service" ? t("Terms of Service") : t("Privacy Policy");
	const lead = t("Engram's {document} changes on {date}.", { document: doc, date });
	const action = n.material ? ` ${t("Accept it in the Engram web app to keep syncing.")}` : "";
	return `${lead} ${n.changelog ?? ""}${action}`.replace(/\s+/gu, " ").trim();
}

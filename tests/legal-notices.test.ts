import { describe, expect, test } from "bun:test";
import { type LegalNotice, noticeKey, noticesToShow, noticeText } from "../src/legal-notices";

const privacy: LegalNotice = {
	document: "privacy_policy",
	version: "2026-10-12",
	effective_date: "2026-11-11",
	material: false,
	changelog: "App analytics now linked to your account.",
	url: "https://engram.page/privacy",
	accept_url: "https://app.engram.page/onboard/agreement",
};
const terms: LegalNotice = { ...privacy, document: "terms_of_service", material: true };

describe("noticesToShow", () => {
	test("a notice-only change shows once", () => {
		expect(noticesToShow([privacy], [])).toEqual([privacy]);
		expect(noticesToShow([privacy], [noticeKey(privacy)])).toEqual([]);
	});

	test("a material change shows every time until accepted", () => {
		expect(noticesToShow([terms], [noticeKey(terms)])).toEqual([terms]);
	});

	test("a seen older version does not hide a newer one", () => {
		expect(noticesToShow([privacy], ["privacy_policy@2026-06-20"])).toEqual([privacy]);
	});
});

describe("noticeText", () => {
	test("names the document, date and change", () => {
		const text = noticeText(privacy, "en");
		expect(text).toContain("Privacy Policy changes on November 11, 2026.");
		expect(text).toContain("App analytics now linked to your account.");
	});

	test("a material change says it must be accepted", () => {
		expect(noticeText(terms, "en")).toContain("Accept it in the Engram web app");
	});
});

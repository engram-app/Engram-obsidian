import { describe, expect, it } from "bun:test";
import { capHintText, unsearchableCount, unsearchableNotesText } from "../src/search-ui";

describe("unsearchableCount", () => {
	it("counts the notes past the cap", () => {
		expect(unsearchableCount(2000, 4312)).toBe(2312);
	});

	it("is zero when every note fits", () => {
		expect(unsearchableCount(2000, 2000)).toBe(0);
		expect(unsearchableCount(2000, 812)).toBe(0);
	});

	it("is zero on an uncapped plan, including the -1 sentinel", () => {
		expect(unsearchableCount(null, 9999)).toBe(0);
		expect(unsearchableCount(-1, 9999)).toBe(0);
	});
});

describe("unsearchableNotesText", () => {
	it("leads with the number the user is losing", () => {
		// Settings is not a search context, so "Searching 2,000 of 4,312" would
		// read as a status of something the user is not doing. Here the subject
		// is the shortfall.
		expect(unsearchableNotesText(2000, 4312)).toBe(
			"2,312 of your 4,312 notes are not searchable. Your plan indexes 2,000, oldest first, so your newest notes are the ones left out. Upgrade to search everything.",
		);
	});

	it("stays quiet whenever the count is zero", () => {
		expect(unsearchableNotesText(2000, 2000)).toBeNull();
		expect(unsearchableNotesText(null, 9999)).toBeNull();
		expect(unsearchableNotesText(-1, 9999)).toBeNull();
	});
});

describe("capHintText", () => {
	it("names both numbers when the vault exceeds the cap", () => {
		// The whole point is specificity: "some notes aren't indexed" would not
		// tell the user which ones, or that paying fixes it.
		expect(capHintText(2000, 4312)).toBe(
			"Searching 2,000 of 4,312 notes. Upgrade to search everything.",
		);
	});

	it("stays quiet when every note is indexed", () => {
		expect(capHintText(2000, 2000)).toBeNull();
		expect(capHintText(2000, 812)).toBeNull();
	});

	it("stays quiet on an uncapped plan", () => {
		expect(capHintText(null, 9999)).toBeNull();
	});

	it("treats a negative cap as unlimited, not as a cap of -1", () => {
		// -1 is the backend's "unlimited" sentinel. Reading it as a literal cap
		// would claim every note is unsearchable on the most permissive plan —
		// the same inversion that made `attachments_text_only` block self-host
		// attachments.
		expect(capHintText(-1, 9999)).toBeNull();
	});
});

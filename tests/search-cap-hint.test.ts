import { describe, expect, it } from "bun:test";
import { capHintText } from "../src/search-ui";

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

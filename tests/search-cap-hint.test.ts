import { describe, expect, it } from "bun:test";
import {
	capHintText,
	DEFAULT_SEARCH_MODE,
	SELECTABLE_MODES,
	unsearchableCount,
} from "../src/search-ui";

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

describe("capHintText", () => {
	it("names both numbers when the vault exceeds the cap", () => {
		// The whole point is specificity: "some notes aren't indexed" would not
		// tell the user which ones, or that paying fixes it.
		expect(capHintText(2000, 4312, false)).toBe(
			"Searching 2,000 of 4,312 notes. Upgrade to search everything.",
		);
	});

	it("does not claim the extra notes are unsearchable when local is fused in", () => {
		// Keyword and Both search the local vault too, so every note IS reachable
		// in those modes. "Searching 2,000 of 4,312" would be false there, and
		// false in the direction of underselling what the plugin just did.
		expect(capHintText(2000, 4312, true)).toBe(
			"Engram indexes 2,000 of your 4,312 notes. The rest match on this device only. Upgrade to index everything.",
		);
	});

	it("stays quiet when every note is indexed", () => {
		expect(capHintText(2000, 2000, true)).toBeNull();
		expect(capHintText(2000, 812, false)).toBeNull();
	});

	it("stays quiet on an uncapped plan", () => {
		expect(capHintText(null, 9999, true)).toBeNull();
	});

	it("treats a negative cap as unlimited, not as a cap of -1", () => {
		// -1 is the backend's "unlimited" sentinel. Reading it as a literal cap
		// would claim every note is unsearchable on the most permissive plan —
		// the same inversion that made `attachments_text_only` block self-host
		// attachments.
		expect(capHintText(-1, 9999, false)).toBeNull();
	});
});

describe("search mode picker", () => {
	it("offers all three modes with Both in the middle", () => {
		// Both is the default, and the row reads as a spectrum: literal words,
		// words plus meaning, meaning alone.
		// The mode that spans both ends belongs between them, not at an edge.
		expect(SELECTABLE_MODES).toEqual(["keyword", "hybrid", "semantic"]);
	});

	it("opens on Both, and offers it, so exactly one button is ever active", () => {
		// Every panel starts here; the mode is deliberately NOT remembered
		// between openings. If the default ever left the list, the picker would
		// render with no active button at all.
		expect(DEFAULT_SEARCH_MODE).toBe("hybrid");
		expect(SELECTABLE_MODES).toContain(DEFAULT_SEARCH_MODE);
	});
});

/**
 * tInto with several slots: a sentence holding two links stays ONE key, so the
 * translator sees it whole and may reorder the links, instead of translating
 * fragments ("Create a hosted account at ", ", or self-host the backend (").
 */
import { afterAll, describe, expect, test } from "bun:test";
import { t, tInto } from "../src/i18n";
import { __setLanguage } from "./__mocks__/obsidian";

afterAll(() => __setLanguage("en"));

function fakeEl() {
	const spans: string[] = [];
	const el = {
		spans,
		createSpan(o: { text?: string }) {
			spans.push(o.text ?? "");
			return el;
		},
	};
	return el;
}

const link = (text: string) => (p: HTMLElement) => {
	(p as unknown as ReturnType<typeof fakeEl>).createSpan({ text: `[${text}]` });
};

describe("tInto with a slot map", () => {
	test("builds each slot where its placeholder sits", () => {
		__setLanguage("en");
		const el = fakeEl();
		tInto(el as never, "Create an account at {signup}, or self-host ({guide}).", {
			signup: link("app"),
			guide: link("guide"),
		});
		expect(el.spans).toEqual([
			"Create an account at ",
			"[app]",
			", or self-host (",
			"[guide]",
			").",
		]);
	});

	test("a slot the translation dropped is still rendered, at the end", () => {
		__setLanguage("en");
		const el = fakeEl();
		tInto(el as never, "Only {signup} here", { signup: link("app"), guide: link("guide") });
		expect(el.spans).toEqual(["Only ", "[app]", " here", "[guide]"]);
	});

	test("an unknown placeholder is left as text", () => {
		__setLanguage("en");
		const el = fakeEl();
		tInto(el as never, "{who} at {signup}", { signup: link("app") });
		expect(el.spans).toEqual(["{who} at ", "[app]"]);
	});
});

describe("{count} as a styled slot", () => {
	test("the count still picks the plural form while a span renders the number", () => {
		__setLanguage("en");
		const one = fakeEl();
		tInto(one as never, "{count} conflicts need resolution", "count", link("1"), {
			vars: { count: 1 },
		});
		expect(one.spans).toEqual(["[1]", " conflict needs resolution"]);
		const many = fakeEl();
		tInto(many as never, "{count} conflicts need resolution", "count", link("3"), {
			vars: { count: 3 },
		});
		expect(many.spans).toEqual(["[3]", " conflicts need resolution"]);
	});
});

describe("t() formats {count} for the locale", () => {
	test("thousands separators follow the app language", () => {
		__setLanguage("en");
		expect(t("{count} files", { count: 1234 })).toBe("1,234 files");
		expect(t("{count} files", { count: 1 })).toBe("1 file");
		__setLanguage("de");
		expect(t("{count} files", { count: 1234 })).toContain("1.234");
		__setLanguage("en");
	});
});

/**
 * The Welcome tab's plan cards ship in plugin releases that can run against a
 * backend whose limits differ, so they must not hardcode a notes number.
 */
import { describe, expect, test } from "bun:test";
import { renderAboutTab } from "../src/tabs/about-tab";
import { makeEl } from "./__mocks__/obsidian";

function texts(el: any): string[] {
	return [el.textContent ?? "", ...el.children.flatMap((c: any) => texts(c))];
}

describe("About tab plan cards", () => {
	test("no hardcoded notes limit", () => {
		const containerEl = makeEl();
		renderAboutTab({ containerEl, switchToTab: () => {} } as any);
		expect(texts(containerEl).filter((x) => /\d[\d,.]*\s*notes/i.test(x))).toEqual([]);
	});
});

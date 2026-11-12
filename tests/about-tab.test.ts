import { describe, expect, test } from "bun:test";
import { planCards } from "../src/tabs/about-tab";

// Prod (backend LimitKeys): every stored note is searchable on every plan, and
// API keys plus MCP work on every plan (#1974). The cards used to say
// "2,000 notes searchable" on Free and list "API access" as a Pro feature.
describe("about tab plan cards match prod", () => {
	const all = planCards().flatMap(([name, features]) => [name, ...features]);

	test("no card caps search coverage or names a note count", () => {
		expect(all.some((l) => /searchable/i.test(l))).toBe(false);
		expect(all.some((l) => /\d,\d{3}/.test(l))).toBe(false);
	});

	test("Free says it searches every note", () => {
		const free = planCards().find(([name]) => name === "Free")?.[1] ?? [];
		expect(free).toContain("Search all your notes");
	});

	test("API access is not sold as a Pro feature", () => {
		const pro = planCards().find(([name]) => name === "Pro")?.[1] ?? [];
		expect(pro.some((l) => /api/i.test(l))).toBe(false);
	});
});

import { describe, expect, test } from "bun:test";
import { betaVersion, nextPatch, prVersion } from "../scripts/release-version.mjs";

describe("nextPatch", () => {
	test("bumps the patch component", () => {
		expect(nextPatch("1.12.26")).toBe("1.12.27");
		expect(nextPatch("2.0.0")).toBe("2.0.1");
	});
	test("rejects non-semver", () => {
		expect(() => nextPatch("1.12")).toThrow();
	});
});

describe("betaVersion", () => {
	test("suffixes -beta.N onto the next patch", () => {
		expect(betaVersion("1.12.26", 3)).toBe("1.12.27-beta.3");
	});
	test("sorts below the eventual stable (patch, minor, major)", () => {
		// Bun ships semver; use it to assert ordering the way Obsidian compares.
		expect(Bun.semver.order("1.12.27-beta.5", "1.12.27")).toBe(-1); // patch cut
		expect(Bun.semver.order("1.12.27-beta.5", "1.13.0")).toBe(-1); // minor cut
		expect(Bun.semver.order("1.12.27-beta.5", "2.0.0")).toBe(-1); // major cut
	});
});

describe("prVersion", () => {
	test("is a valid, unique-per-commit prerelease", () => {
		expect(prVersion("1.12.26", 42, "a1b2c3d")).toBe("1.12.27-pr.42.a1b2c3d");
	});
});

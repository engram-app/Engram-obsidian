import { describe, expect, test } from "bun:test";
import { usedEntries, usedKeys } from "../src/i18n/keys-scan";

describe("usedKeys", () => {
	test("finds t() and tInto() keys in both quote styles, unescaped", () => {
		const src = [
			`t("Sync now")`,
			`t('Rename "{name}"', { name })`,
			`tInto(el, "Version: {version}", "version", b)`,
			`tInto(el, 'Say "{word}"', "word", b)`,
			`t("A \\"quoted\\" word")`,
		].join("\n");
		expect([...usedKeys([src])].sort()).toEqual(
			[
				'A "quoted" word',
				'Rename "{name}"',
				'Say "{word}"',
				"Sync now",
				"Version: {version}",
			].sort(),
		);
	});

	test("does not read tInto's key as a t() key or catch lookalikes", () => {
		expect([...usedKeys([`format("x") at("y") tInto(el, "k", "s", b)`])]).toEqual(["k"]);
	});
});

describe("usedEntries", () => {
	test("deduplicates and attaches the English one-form for plural keys", () => {
		const entries = usedEntries([`t("{count} files", { count }) t("Save") t("Save")`], {
			"{count} files": { one: "{count} file" },
		});
		expect(entries).toEqual([
			{ key: "{count} files", plural: { one: "{count} file" } },
			{ key: "Save" },
		]);
	});
});

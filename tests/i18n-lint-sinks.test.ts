/**
 * The lint gate that stops English reaching the UI without passing through t().
 * The selectors are esquery strings, so a typo silently matches nothing; these
 * fixtures prove each sink is actually covered and each allowed case passes.
 */
import { describe, expect, test } from "bun:test";
import tsParser from "@typescript-eslint/parser";
import { Linter } from "eslint";
import { I18N_RESTRICTED_SYNTAX } from "../scripts/eslint-i18n-sinks";

const linter = new Linter({ configType: "flat" });

function violations(code: string): number {
	return linter.verify(
		code,
		[
			{
				files: ["**/*.ts"],
				languageOptions: { parser: tsParser },
				rules: { "no-restricted-syntax": ["error", ...I18N_RESTRICTED_SYNTAX] },
			},
		],
		"fixture.ts",
	).length;
}

describe("raw English literals in UI sinks are rejected", () => {
	const bad = [
		`new Notice("Starting...");`,
		`new Notice(\`Sync failed for \${path}\`);`,
		`setting.setName("Server URL");`,
		`setting.setDesc("Where your notes live");`,
		`button.setButtonText("Connect");`,
		`button.setTooltip("Copy code");`,
		`text.setPlaceholder("Search notes");`,
		`item.setTitle("Open Sync Center");`,
		`el.setText("Starting...");`,
		`el.appendText(" and more");`,
		`notice.setMessage("Done");`,
		`el.createEl("p", { text: "Hello there" });`,
		`el.createDiv({ text: "Hello there", cls: "x" });`,
		`el.createSpan({ text: ok ? "Yes" : "No" });`,
		`el.createSpan({ text: a ? t("x") : b ? t("y") : "meaning" });`,
		`createEl("p", { text: "Global" });`,
		`this.addCommand({ id: "x", name: "Open search", callback });`,
		`this.addRibbonIcon("search", "Search notes", cb);`,
		`el.setText(label ?? "Unknown");`,
		`el.setText(count + " files");`,
		`el.setText(a + " of " + b);`,
		`el.setText(\`\${n}s ago\`);`,
	];
	for (const code of bad) {
		test(code, () => expect(violations(code)).toBeGreaterThan(0));
	}
});

describe("error text in UI sinks or t() vars is rejected", () => {
	const bad = [
		`new Notice(e.message);`,
		`el.setText(errMsg(e));`,
		`new Notice(\`Engram: \${e.message}\`);`,
		`el.createDiv({ text: err.message });`,
		`t("Sync failed: {reason}", { reason: e.message });`,
		`t("Sync failed: {reason}", { reason: errMsg(e) });`,
		`t("Failed: {r}", { r: \`\${errMsg(e)}\` });`,
		`t("Engram Sync: {details}", { details: e instanceof Error ? e.message : t("sync failed") });`,
		`reason.createSpan({ text: issue.parseReason.message });`,
	];
	for (const code of bad) {
		test(code, () => expect(violations(code)).toBeGreaterThan(0));
	}
});

describe("translated, data-only and allowed values pass", () => {
	const good = [
		`new Notice(t("Starting..."));`,
		`el.setText(t("{count} files", { count }));`,
		`el.setText("—");`,
		`el.setText("5s");`,
		`el.setText(String(count));`,
		`el.setText(path);`,
		`el.createEl("a", { text: "GitHub", href: "https://github.com" });`,
		`el.createEl("a", { text: "https://engram.page" });`,
		`el.createEl("a", { text: "github.com/engram-app/engram", href });`,
		`el.createSpan({ text: "Ko-fi" });`,
		`text.setPlaceholder("engram_abc123...");`,
		`el.createSpan({ cls: "engram-status", text: t("Connected") });`,
		`this.addRibbonIcon("search", t("Search notes"), cb);`,
		`this.addCommand({ id: "open-search", name: t("Open search"), callback });`,
		`t("Sync failed: {reason}", { reason: userErrorMessage(e) });`,
		`log.warn("push failed: " + e.message);`,
		`console.error(errMsg(e));`,
	];
	for (const code of good) {
		test(code, () => expect(violations(code)).toBe(0));
	}
});

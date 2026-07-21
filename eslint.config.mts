// ESLint config — kept 1:1 with the official Obsidian sample-plugin template
// (obsidianmd/obsidian-sample-plugin): same `projectService` type-resolution,
// `obsidianmd.configs.recommended`, and jiti-loaded `.mts` config. Staying on
// the template's tooling is what keeps the community dashboard audit happy —
// the audit runs the type-checked obsidianmd rules in its own sandbox, so the
// repo must resolve `obsidian`'s types exactly the way the template does.
//
// Our only additions on top of the template: the `obsidianmd/ui/sentence-case`
// brand allow-list for src files.
import { globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	globalIgnores([
		"node_modules/**",
		"tests/**",
		"docs/**",
		"main.js",
		"version-bump.mjs",
		"esbuild.config.mjs",
		"versions.json",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mts", "manifest.json"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		rules: {
			// Deferred, tracked in #270. This rule is a pure syntactic presence
			// check: it only asks whether a `getSettingDefinitions` member exists
			// and never inspects the return value, so `return []` would satisfy
			// both it and the community scanner while changing nothing. That is
			// suppression wearing adoption's clothes.
			//
			// Real adoption is a full settings-UI rewrite, not an additive
			// change: per obsidian.d.ts, a non-empty return means Obsidian 1.13+
			// renders the tab itself and `display()` is NEVER called. Our tab
			// bar, status bar, device-flow auth, network-sourced vault dropdown
			// and waitlist form all live in `display()`. It also has a
			// brick-the-plugin hazard (SettingPage is a runtime class; touching
			// it at module scope throws on Obsidian < 1.13, and our
			// minAppVersion is 1.7.2).
			//
			// Turning it off rather than stubbing it keeps the scanner honest:
			// it will keep reporting the warning until #270 actually lands.
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
			"obsidianmd/ui/sentence-case": [
				"error",
				{
					enforceCamelCaseLower: true,
					brands: [
						"Engram",
						"Obsidian",
						"GitHub",
						"OAuth",
						"Ollama",
						"Qdrant",
						"BRAT",
					],
					ignoreRegex: [
						String.raw`https?://\S+`,
						String.raw`\bgithub\.com/\S+`,
						String.raw`engram_[A-Za-z0-9_]+`,
					],
				},
			],
		},
	},
);

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
			// Adopted (#270). `EngramSyncSettingTab.getSettingDefinitions()`
			// returns a single `render`-hatch item that hosts the existing
			// custom UI (tab bar, status, device-flow) via renderContent(), so
			// on 1.13+ the tab renders identically while being registered in
			// settings search — additive, not the full-UI rewrite this comment
			// previously assumed. `display()` is kept as the <1.13 fallback
			// (minAppVersion 1.7.2). No module-scope runtime touch (type-only
			// imports; the hatch body only runs on 1.13+), so no brick hazard.
			// Ceiling: indexed as one entry, not per-setting. Enforced now so a
			// future settings tab can't regress the search registration.
			"obsidianmd/settings-tab/prefer-setting-definitions": "error",
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

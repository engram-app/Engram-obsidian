import { Notice, Setting, TFolder } from "obsidian";
import { errMsg } from "../error-util";
import { t, tInto } from "../i18n";
import { rlog } from "../remote-log";
import type { EngramSyncSettings } from "../types";
import type { TabContext } from "./types";

/** Directories that should never be synced — detect and warn if found in vault. */
/** Resolved per call, never as a module-scope literal: a literal is
 *  evaluated once at bundle load and freezes to whichever language was active
 *  then. */
function problematicDirs() {
	return [
		{ pattern: "node_modules/", label: "node_modules", desc: t("Node.js dependencies") },
		{ pattern: ".venv/", label: ".venv", desc: t("Python virtual environment") },
		{ pattern: "venv/", label: "venv", desc: t("Python virtual environment") },
		{ pattern: "__pycache__/", label: "__pycache__", desc: t("Python bytecode cache") },
		{ pattern: "vendor/", label: "vendor", desc: t("Vendored dependencies") },
		{ pattern: ".gradle/", label: ".gradle", desc: t("Gradle build cache") },
		{ pattern: "target/", label: "target", desc: t("Rust/Java build output") },
		{ pattern: "build/", label: "build", desc: t("Build output") },
		{ pattern: ".next/", label: ".next", desc: t("Next.js build output") },
		{ pattern: "dist/", label: "dist", desc: t("Distribution build output") },
		{ pattern: ".cargo/", label: ".cargo", desc: t("Cargo cache") },
		{ pattern: "Pods/", label: "Pods", desc: t("CocoaPods dependencies") },
		{ pattern: ".dart_tool/", label: ".dart_tool", desc: t("Dart tool cache") },
		{ pattern: ".cache/", label: ".cache", desc: t("Generic cache directory") },
	];
}

export function renderAdvancedTab(ctx: TabContext): void {
	const { containerEl, app, plugin, redisplay } = ctx;

	// ── Ignore patterns ──
	new Setting(containerEl).setName(t("Ignore patterns")).setHeading();

	renderIgnoreWarnings(containerEl, app, plugin, redisplay);

	const ignoreSetting = new Setting(containerEl)
		.setName(t("Custom patterns"))
		.setDesc(
			t(
				"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/",
				{ configDir: app.vault.configDir },
			),
		)
		.addTextArea((text) => {
			text.setPlaceholder("drafts/\nsecret.md")
				.setValue(plugin.settings.ignorePatterns)
				.onChange(async (value) => {
					plugin.settings.ignorePatterns = value;
					await plugin.saveSettings();
				});
			text.inputEl.rows = 6;
			text.inputEl.addClass("engram-ignore-textarea");
		});
	ignoreSetting.settingEl.addClass("engram-ignore-setting");

	renderExcludedFolders(containerEl, plugin, redisplay);

	// ── Diagnostics ──
	new Setting(containerEl).setName(t("Diagnostics")).setHeading();

	new Setting(containerEl)
		.setName(t("Diagnostics"))
		.setDesc(
			t(
				"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.",
			),
		)
		.addToggle((toggle) =>
			toggle.setValue(plugin.settings.diagnosticsEnabled).onChange(async (value) => {
				plugin.settings.diagnosticsEnabled = value;
				await plugin.saveSettings();
			}),
		);

	new Setting(containerEl)
		.setName(t("Diagnostics detail"))
		.setDesc(
			t(
				"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.",
			),
		)
		.addDropdown((dropdown) =>
			dropdown
				.addOptions({
					error: t("Errors only"),
					warn: t("Warnings and errors"),
					info: t("Info (default)"),
					debug: t("Debug (verbose)"),
				})
				.setValue(plugin.settings.remoteLogLevel)
				.onChange(async (value) => {
					plugin.settings.remoteLogLevel = value as EngramSyncSettings["remoteLogLevel"];
					await plugin.saveSettings();
				}),
		);

	// ── About ──
	new Setting(containerEl).setName(t("About")).setHeading();

	const aboutList = containerEl.createEl("ul", { cls: "engram-about-list" });

	const versionItem = aboutList.createEl("li");
	tInto(versionItem, "Version: {version}", "version", (item) => {
		item.createSpan({ text: plugin.manifest.version });
	});

	const repoItem = aboutList.createEl("li");
	tInto(repoItem, "Source: {link}", "link", (item) => {
		item.createEl("a", {
			text: "github.com/engram-app/Engram-obsidian",
			href: "https://github.com/engram-app/Engram-obsidian",
		});
	});

	const licenseItem = aboutList.createEl("li");
	licenseItem.createSpan({ text: t("License: {name}", { name: "MIT" }) });
}

/** Scan vault for problematic directories and render warnings with add-to-ignore buttons. */
function renderIgnoreWarnings(
	containerEl: HTMLElement,
	app: TabContext["app"],
	plugin: TabContext["plugin"],
	redisplay: () => void,
): void {
	const currentIgnores = plugin.settings.ignorePatterns;
	const detected: { pattern: string; label: string; desc: string; count: number }[] = [];

	for (const dir of problematicDirs()) {
		if (currentIgnores.includes(dir.pattern)) continue;

		const folder = app.vault.getFolderByPath(dir.label);
		if (folder) {
			let count = 0;
			const walk = (f: TFolder) => {
				for (const child of f.children) {
					if (child instanceof TFolder) walk(child);
					else count++;
				}
			};
			walk(folder);
			detected.push({ ...dir, count });
		}
	}

	if (detected.length === 0) return;

	for (const item of detected) {
		const warning = new Setting(containerEl)
			.setName(
				t("⚠ Detected: {label}/ ({formatted} files)", {
					label: item.label,
					// `count` selects the plural category and must stay numeric;
					// `formatted` is what the sentence prints.
					count: item.count,
					formatted: item.count.toLocaleString(),
				}),
			)
			.setDesc(t("{desc} — should not be synced", { desc: item.desc }))
			.addButton((btn) =>
				btn
					.setButtonText(t("Add to ignores"))
					.setCta()
					.onClick(async () => {
						const current = plugin.settings.ignorePatterns.trim();
						plugin.settings.ignorePatterns = current
							? `${current}\n${item.pattern}`
							: item.pattern;
						await plugin.saveSettings();
						new Notice(
							t("Added {pattern} to ignore patterns", { pattern: item.pattern }),
						);
						redisplay();
					}),
			);
		warning.settingEl.addClass("engram-status-warning");
	}
}

/** Folders unticked in the first-sync folder picker (settings.excludedFolders).
 *  Listed under the ignore patterns so they are not invisible, each with a way
 *  to sync it again. Nothing renders when none are excluded. */
export function renderExcludedFolders(
	containerEl: HTMLElement,
	plugin: Pick<TabContext["plugin"], "settings" | "syncFolderAgain">,
	redisplay: () => void,
): void {
	const folders = plugin.settings.excludedFolders;
	if (folders.length === 0) return;
	new Setting(containerEl)
		.setName(t("Excluded folders"))
		.setDesc(t("Top-level folders you chose not to sync."))
		.setHeading();
	for (const folder of folders) {
		let busy = false;
		new Setting(containerEl).setName(folder).addButton((btn) =>
			btn.setButtonText(t("Sync again")).onClick(async () => {
				// Busy while it runs (the quota check can wait on the network), and
				// a second click must not start a second re-include.
				if (busy) return;
				busy = true;
				btn.setDisabled(true);
				try {
					await plugin.syncFolderAgain(folder);
				} catch (e: unknown) {
					rlog().error("settings", `Sync again failed for a folder: ${errMsg(e)}`);
					new Notice(t("Could not save your folder choice. Try again."));
				} finally {
					busy = false;
					btn.setDisabled(false);
					redisplay();
				}
			}),
		);
	}
}

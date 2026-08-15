import { Notice, Setting, setIcon } from "obsidian";
import { EngramApi } from "../api";
import {
	applyApiUrlChange,
	completeOrigin,
	type PreflightResult,
	pluginSwitchTarget,
} from "../auth-state";
import { modeForUrl } from "../backend-mode";
import { errMsg } from "../error-util";
import type { TabContext } from "./types";
import { ENGRAM_CLOUD_URL, ENGRAM_MARKETING_URL } from "./urls";

const PREFLIGHT_DEBOUNCE_MS = 600;

/** Engram API keys carry this prefix. Kept as a constant so the key field can
 *  VALIDATE the format instead of describing it: the obsidianmd sentence-case
 *  lint rewrites a lowercase "engram_" in prose to "Engram_", which is wrong. */
const API_KEY_PREFIX = "engram_";

/** Render the "Engram URL" field with a debounced background preflight that
 *  confirms the URL points at a real Engram server, and commits on that
 *  confirmation.
 *
 *  There is deliberately no Save button. The preflight already tells the user
 *  whether the address works; a button next to it asked them to confirm a
 *  thing the page had just confirmed for them.
 *
 *  Why keystrokes still only buffer: the original handler called
 *  `applyApiUrlChange` on every keystroke. Once a complete origin was typed it
 *  cleared auth and `redisplay()`'d the whole tab mid-edit — destroying the
 *  input and stealing focus on every character. Commit is therefore reached
 *  from exactly two places, both of which mean "the user is done typing": a
 *  probe that confirms an Engram backend, or blur. */
export function renderEngramUrlSetting(ctx: TabContext): void {
	const { containerEl, plugin, redisplay } = ctx;

	const setting = new Setting(containerEl).setName("Engram URL");
	setting.settingEl.addClass("engram-url-setting");

	const status = setting.descEl.createDiv({ cls: "engram-url-preflight" });
	const STATUS_CLASSES = ["is-checking", "is-engram", "is-reachable", "is-unreachable"];

	// Buffer the typed value; only commit() writes it to settings.
	let pendingUrl = plugin.settings.apiUrl;
	let debounce: number | null = null;
	// Monotonic token: a slow probe that resolves after the user kept typing
	// must not overwrite the status belonging to a newer value.
	let probeSeq = 0;

	const renderStatus = (result: PreflightResult): void => {
		status.removeClasses(STATUS_CLASSES);
		switch (result.kind) {
			case "engram":
				status.addClass("is-engram");
				status.setText(`✓ Engram server reachable (v${result.version})`);
				break;
			case "reachable":
				status.addClass("is-reachable");
				status.setText("✗ server responded but isn't an Engram backend");
				break;
			case "unreachable":
				status.addClass("is-unreachable");
				status.setText("✗ couldn't reach a server at this URL");
				break;
		}
	};

	const runPreflight = (value: string, mayCommit = false): void => {
		if (!completeOrigin(value)) {
			status.removeClasses(STATUS_CLASSES);
			status.setText("");
			return;
		}
		const seq = ++probeSeq;
		status.removeClasses(STATUS_CLASSES);
		status.addClass("is-checking");
		status.setText("Checking server…");
		void EngramApi.probeHealth(value).then((result) => {
			if (seq !== probeSeq) return; // superseded by a newer probe
			status.removeClass("is-checking");
			renderStatus(result);
			// The probe IS the confirmation — a Save button next to it was a
			// second, worse one. Commit only on a verified Engram backend:
			// "reachable" means something answered but is not Engram, and
			// committing that would clear auth for a typo.
			if (mayCommit && result.kind === "engram") void commit();
		});
	};

	/** The one place that may clear auth and redisplay. applyApiUrlChange is a
	 *  backend IDENTITY swap, so it must never fire mid-keystroke: only on a
	 *  confirmed Engram server, or on blur once the user has stopped typing. */
	const commit = async (): Promise<void> => {
		const next = pendingUrl.trim();
		if (next === plugin.settings.apiUrl) return;
		const { cleared, rejected } = await applyApiUrlChange(
			pluginSwitchTarget(plugin),
			next,
			() => plugin.saveSettings(),
		);
		if (rejected) {
			// Deliberately no redisplay: the typed value stays in the box so the
			// user can correct it instead of retyping from scratch.
			new Notice(
				"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000",
			);
			return;
		}
		// Keep the explicit mode in step with the URL. Pasting the Cloud address
		// into this box IS a switch to Cloud; leaving backendMode on "selfhost"
		// would make the next dropdown switch stash the Cloud config into the
		// self-host slot.
		plugin.settings.backendMode = modeForUrl(plugin.settings.apiUrl, ENGRAM_CLOUD_URL);
		await plugin.saveSettings();
		if (cleared) {
			new Notice("Engram backend changed — sign in again to continue.");
		}
		redisplay();
	};

	setting.addText((text) => {
		// Pre-fill the saved URL so the configured backend is always visible
		// (unlike the API-key field, the URL isn't a secret and the user needs
		// to confirm it's correct).
		text.setPlaceholder("https://engram.example.com");
		text.setValue(plugin.settings.apiUrl);
		text.onChange((value) => {
			pendingUrl = value;
			if (debounce !== null) window.clearTimeout(debounce);
			debounce = window.setTimeout(() => runPreflight(value, true), PREFLIGHT_DEBOUNCE_MS);
		});
		// Blur fallback: someone pointing at a server they have not started yet
		// would otherwise be unable to save at all, because the probe never
		// confirms. Leaving the field is an unambiguous "I meant that".
		text.inputEl.addEventListener("blur", () => {
			if (debounce !== null) window.clearTimeout(debounce);
			void commit();
		});
	});

	// Surface the current backend's status immediately on open (no typing needed).
	if (completeOrigin(plugin.settings.apiUrl)) runPreflight(plugin.settings.apiUrl);
}

/** Render Authentication section — OAuth status / API key / sign-in CTAs.
 *
 *  States:
 *    - Unauth: a Sign-in row, then an "API key" heading and its Token row.
 *    - OAuth locked: only the signed-in row + Sign out.
 *    - API key locked: only the "Using API key" row + Clear / Switch to sign in.
 *
 *  Cloud mode hangs the engram.page link off the Authentication HEADING, not
 *  the sign-in row: the two locked states return early, so a link on the
 *  sign-in row is invisible to every signed-in user — which is precisely who
 *  needs the account and billing pages. */
export function renderAuthSection(ctx: TabContext): void {
	const { containerEl, plugin, redisplay, startDeviceFlow } = ctx;

	const isOAuth = !!plugin.settings.refreshToken;
	const hasApiKey = !!plugin.settings.apiKey;

	const heading = new Setting(containerEl).setName("Authentication").setHeading();
	if ((plugin.settings.backendMode ?? "selfhost") === "cloud") {
		// Descriptive link text, not "Learn more": the destination should be
		// readable from the link alone (screen-reader link lists give no
		// surrounding context).
		heading.descEl.createEl("a", {
			text: "engram.page",
			href: ENGRAM_MARKETING_URL,
			attr: { target: "_blank", rel: "noopener" },
		});
	}

	if (isOAuth) {
		new Setting(containerEl)
			.setName(`Signed in as ${plugin.settings.userEmail ?? "unknown"}`)
			.setDesc("Authenticated via Engram account (OAuth).")
			.addButton((btn) =>
				btn.setButtonText("Sign out").onClick(async () => {
					await plugin.clearOAuthTokens();
					redisplay();
				}),
			);
		return;
	}

	if (hasApiKey) {
		new Setting(containerEl)
			.setName("Using API key")
			.setDesc("Authenticated via manual API key.")
			.addButton((btn) =>
				btn
					.setButtonText("Clear key")
					.setWarning()
					.onClick(async () => {
						plugin.settings.apiKey = "";
						await plugin.saveSettings();
						redisplay();
					}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Switch to sign in")
					.setCta()
					.onClick(async () => {
						plugin.settings.apiKey = "";
						await plugin.saveSettings();
						startDeviceFlow().catch((e) => {
							new Notice(`Engram: sign-in failed (${errMsg(e)})`);
						});
					}),
			);
		return;
	}

	// One row covers both new and returning users. The device-flow page sits
	// behind the web app's AuthGuard, so a signed-out browser lands on the
	// sign-in screen, which offers account creation. There is no separate
	// "make an account first" step, and advertising one implied a prerequisite
	// that does not exist.
	new Setting(containerEl)
		.setName("Sign in with Engram")
		.setDesc(
			"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.",
		)
		.addButton((btn) =>
			btn
				.setButtonText("Sign in")
				.setCta()
				// A rejected device flow (saveOAuthTokens throwing) otherwise
				// vanishes into the button handler with nothing on screen.
				.onClick(() =>
					startDeviceFlow().catch((e) => {
						new Notice(`Engram: sign-in failed (${errMsg(e)})`);
					}),
				),
		);

	// setHeading(), matching every other section break in the settings UI (Sync
	// behavior, Diagnostics, Feature flags). A heading draws its own divider, so
	// this replaced a hand-rolled one that stacked a second line against the
	// following row's border-top.
	new Setting(containerEl)
		.setName("API key")
		.setDesc("Or authenticate with a token instead of signing in.")
		.setHeading();

	let pendingKey = "";
	const apiKeySetting = new Setting(containerEl)
		.setName("Token")
		// The key prefix is deliberately NOT named here. The obsidianmd
		// sentence-case rule treats "engram" as a proper noun and rewrites it to
		// "Engram_", which is wrong: real keys are lowercase. The input's
		// placeholder shows the true format instead.
		.setDesc("Bearer token from your Engram account.")
		.addText((text) => {
			text.setPlaceholder("engram_abc123...").onChange((value) => {
				pendingKey = value;
			});
			text.inputEl.type = "password";
			text.inputEl.addClass("engram-api-key-input");
		})
		.addButton((btn) =>
			btn
				.setButtonText("Save")
				.setCta()
				.onClick(async () => {
					const trimmed = pendingKey.trim();
					if (!trimmed) {
						new Notice("Enter an API key first");
						return;
					}
					// Check the prefix rather than describing it in prose. The
					// placeholder that showed the format vanishes the moment the
					// field has content, and this field is type=password, so a
					// pasted JWT or truncated key otherwise saved cleanly and only
					// surfaced later as opaque 401s.
					if (!trimmed.startsWith(API_KEY_PREFIX)) {
						new Notice(
							`That does not look like an Engram API key (expected ${API_KEY_PREFIX}…).`,
						);
						return;
					}
					plugin.settings.apiKey = trimmed;
					await plugin.saveSettings();
					redisplay();
				}),
		);
	apiKeySetting.settingEl.addClass("engram-setting-api-key");
}

/** Render Vault selection section. No-op when no auth is configured.
 *
 *  Two modes:
 *    - First-time (no vaultId): dropdown directly so the user can pick.
 *    - Locked-in (vaultId set): read-only "Vault Selection: <name>" + Change button
 *      that opens the SyncPreviewModal in vault-picker view. Switching is
 *      destructive (retargets sync at a different server vault) so the preview
 *      surfaces the new comparison numbers before the user picks a direction. */
export function renderVaultSection(ctx: TabContext): void {
	const { containerEl, plugin, redisplay } = ctx;

	if (!plugin.settings.apiKey && !plugin.settings.refreshToken) return;

	new Setting(containerEl).setName("Vault").setHeading();

	const setting = new Setting(containerEl)
		.setName("Vault selection")
		.setDesc("Select which vault this plugin syncs with.");

	const currentId = plugin.settings.vaultId;
	const storedName = plugin.settings.remoteVaultName;

	// Render locked-in UI immediately from saved state — avoids a "Loading
	// vaults..." flicker every time the user opens settings. The Change
	// button fetches a fresh list on demand.
	if (currentId && storedName) {
		renderLockedVaultRow(setting, plugin, currentId, storedName);
		return;
	}

	const placeholderEl = setting.controlEl.createSpan({ text: "Loading vaults..." });

	plugin.api
		.listVaults()
		.then((vaults) => {
			placeholderEl.remove();

			if (vaults.length === 0) {
				setting.controlEl.createSpan({
					text: "No vaults found — first sync will create one",
				});
				return;
			}

			const current = currentId ? vaults.find((v) => v.id === currentId) : undefined;

			// First-time picker: render the dropdown directly so the user can
			// choose without going through the warning modal.
			if (!current) {
				setting.addDropdown((dropdown) => {
					if (currentId) {
						// Vault id set but no longer exists on server — surface it.
						dropdown.addOption(
							"",
							storedName
								? `Pick a vault (previous: '${storedName}' not found)`
								: `Pick a vault (previous: id ${currentId} not found)`,
						);
					} else {
						dropdown.addOption("", "Pick a vault");
					}
					for (const v of vaults) {
						const label = v.is_default ? `${v.name} (default)` : v.name;
						dropdown.addOption(v.id, label);
					}
					dropdown.onChange(async (value) => {
						const picked = vaults.find((v) => v.id === value);
						if (await applyVaultSwitch(plugin, value, picked?.name)) redisplay();
					});
				});
				return;
			}

			// Locked-in display path for legacy users who have a vaultId but
			// never stored a remoteVaultName. Capture the name now so future
			// renders use the fast path above. Guarded so a re-render doesn't
			// re-write settings when the value is already current.
			if (plugin.settings.remoteVaultName !== current.name) {
				plugin.settings.remoteVaultName = current.name;
				void plugin.saveSettings();
			}

			renderLockedVaultRow(
				setting,
				plugin,
				current.id,
				current.is_default ? `${current.name} (default)` : current.name,
			);
		})
		.catch((e: unknown) => {
			placeholderEl.remove();
			setting.controlEl.createSpan({ text: describeListVaultsError(e) });
		});
}

/** The read-only "Vault selection: <name>" row + Change button, shared by the
 *  saved-state fast path and the legacy fetch path. */
function renderLockedVaultRow(
	setting: Setting,
	plugin: TabContext["plugin"],
	vaultId: string,
	displayName: string,
): void {
	setting.settingEl.addClass("engram-setting-vault-name");
	const nameEl = setting.controlEl.createSpan({
		cls: "engram-vault-current-name",
		text: displayName,
	});
	nameEl.setAttribute("title", `Vault id: ${vaultId}`);

	setting.addButton((btn) =>
		btn.setButtonText("Change").onClick(() => {
			void plugin.doSyncWithFirstSyncCheck({ startInVaultPicker: true });
		}),
	);
}

/** Render the GitHub Sponsors + Ko-fi support section. */
export function renderSupportSection(ctx: TabContext): void {
	const { containerEl } = ctx;

	new Setting(containerEl).setName("Support development").setHeading();

	const supportSetting = new Setting(containerEl).setDesc(
		"If this plugin saves you time, consider supporting development.",
	);
	supportSetting.settingEl.addClass("engram-setting-support");

	const buttonRow = supportSetting.controlEl.createDiv({ cls: "engram-support-buttons" });

	const sponsorLink = buttonRow.createEl("a", {
		cls: "engram-sponsor-button",
		href: "https://github.com/sponsors/engram-app",
		attr: { target: "_blank", rel: "noopener" },
	});
	const sponsorIcon = sponsorLink.createSpan({ cls: "engram-sponsor-icon" });
	setIcon(sponsorIcon, "heart");
	sponsorLink.createSpan({ text: "GitHub Sponsors" });

	const kofiLink = buttonRow.createEl("a", {
		cls: "engram-kofi-button",
		href: "https://ko-fi.com/engrams_sync",
		attr: { target: "_blank", rel: "noopener" },
	});
	const kofiIcon = kofiLink.createSpan({ cls: "engram-kofi-icon" });
	setIcon(kofiIcon, "coffee");
	kofiLink.createSpan({ text: "Ko-fi" });
}

/** Map a `listVaults()` rejection to a short human label suitable for a
 *  dropdown placeholder. Distinguishes 401/403, timeouts, and 5xx from the
 *  legacy "swallow → empty list" behavior. Pure for testing. */
export function describeListVaultsError(e: unknown): string {
	const err = e as { status?: number; message?: string };
	const status = err?.status;
	if (status === 401 || status === 403) return "Sign-in required to load vaults";
	if (status && status >= 500) return `Server error (${status}) — check Engram logs`;
	if (status && status >= 400) return `Request failed (${status})`;
	return "Could not reach Engram — check connection";
}

/** Subset of EngramSyncPlugin used by `applyVaultSwitch`. Defined here so the
 *  helper is unit-testable without dragging in the Obsidian DOM stack. */
export interface VaultSwitchTarget {
	settings: { vaultId: string | null; remoteVaultName?: string };
	api: { setVaultId: (id: string | null) => void };
	saveSettings: () => Promise<void>;
}

/** Apply a user-driven vault switch. Returns `true` if the active vault
 *  actually changed (caller should redisplay). When `name` is provided it is
 *  persisted alongside the id so the sync preview modal can label the cloud
 *  side without an extra round-trip. */
export async function applyVaultSwitch(
	plugin: VaultSwitchTarget,
	value: string,
	name?: string,
): Promise<boolean> {
	if (!value || value === plugin.settings.vaultId) return false;
	plugin.settings.vaultId = value;
	if (name !== undefined) plugin.settings.remoteVaultName = name;
	plugin.api.setVaultId(value);
	await plugin.saveSettings();
	return true;
}

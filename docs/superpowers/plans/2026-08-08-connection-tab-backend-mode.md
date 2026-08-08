# Connection Tab and Explicit Backend Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the derived `apiUrl === ENGRAM_CLOUD_URL` backend-mode check with explicit stored state, and merge the Cloud and Self-hosted settings tabs into one Connection tab with a mode toggle.

**Architecture:** Approach B from the spec. The existing flat settings fields (`apiUrl`, `apiKey`, `refreshToken`, and so on) stay as the ACTIVE backend, so no downstream consumer changes. Two new fields are added: `backendMode` (explicit) and `inactiveBackend` (the other mode's stashed config). Switching modes swaps active and stash in place. A new pure module `src/backend-mode.ts` owns the swap, the migration, and the connection-state derivation.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild, Bun test runner, Biome.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-08-plugin-connection-tab-backend-mode-design.md`
- Branch: work on `docs/connection-tab-backend-mode-spec` (already exists, holds the spec)
- **No em dashes** in any prose, comment, doc, or UI copy. Use a period, comma, colon, or a connecting word.
- **No version bumps.** Do not touch `manifest.json`, `versions.json`, or `package.json` version. release-please owns those.
- Test runner is `bun test`. Run a single file with `bun test tests/<name>.test.ts`.
- Lint before pushing: `bun run lint` (Biome), `bun run lint:obsidian` (ESLint), `bun run lint:css` (Stylelint). Use `./node_modules/.bin/biome` if invoking Biome directly, never `bunx biome`.
- Type-check with `bun run build` (runs `tsc -noEmit` first).
- `settings.backendMode` must NOT be added to `DEFAULT_SETTINGS`. Settings load via `Object.assign({}, DEFAULT_SETTINGS, data?.settings)` (`src/main.ts:1149`), so a default would make a pre-migration install indistinguishable from a migrated one.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types.ts` (modify) | Add `BackendMode`, `BackendScopedField`, `BackendSlot`, `BACKEND_SCOPED_FIELDS`, and the two new settings fields. Types live here to avoid a circular import with `backend-mode.ts`. |
| `src/backend-mode.ts` (create) | Pure functions: `captureSlot`, `applySlot`, `switchMode`, `migrateBackendMode`, `connectionState`. No Obsidian imports. |
| `tests/backend-mode.test.ts` (create) | Unit tests for the above, including the drift guard. |
| `src/tabs/connection-tab.ts` (create) | The merged Connection tab renderer. |
| `src/tabs/self-hosted-tab.ts` (modify) | Keep the shared section renderers. Delete `renderSelfHostedTab` and `renderCloudLockBanner`. |
| `src/tabs/account-tab.ts` (delete) | Folded into the Connection tab. |
| `src/auth-state.ts` (modify) | Delete `cloudTabAction`. Make `withClearedAuth` consume `BACKEND_SCOPED_FIELDS`. Reject unparseable URLs in `applyApiUrlChange`. |
| `src/main.ts` (modify) | Call `migrateBackendMode` in `loadSettings`. |
| `src/settings.ts` (modify) | Tab list: 4 tabs. Default tab id becomes `connection`. |
| `src/tabs/start-tab.ts` (modify) | `pickInitialTab` returns `connection` instead of `account`. |
| `src/tabs/about-tab.ts` (modify) | `switchToTab("account")` becomes `switchToTab("connection")`. |
| `src/sync.ts` (modify) | Independent connection guard in `fullSyncInner`. |
| `tests/auth-state.test.ts` (modify) | Drop `cloudTabAction` tests, add URL-rejection tests. |

**Note on `self-hosted-tab.ts`:** it keeps the shared renderers (`renderEngramUrlSetting`, `renderAuthSection`, `renderVaultSection`, `renderSupportSection`) even though it is no longer a tab. Renaming it to `connection-sections.ts` is reasonable cleanup but is deliberately out of scope here to keep the diff reviewable. `account-tab.ts` already imported from it, so the direction of dependency is unchanged.

---

### Task 1: Backend-scoped field list and slot capture/restore

**Files:**
- Modify: `src/types.ts`
- Create: `src/backend-mode.ts`
- Create: `tests/backend-mode.test.ts`
- Modify: `src/auth-state.ts:76-91` (`withClearedAuth`)

**Interfaces:**
- Consumes: `EngramSyncSettings` from `src/types.ts`
- Produces: `BACKEND_SCOPED_FIELDS: readonly BackendScopedField[]`, `type BackendMode = "cloud" | "selfhost"`, `type BackendSlot`, `captureSlot(settings: EngramSyncSettings): BackendSlot`, `applySlot(settings: EngramSyncSettings, slot: BackendSlot): void`

- [ ] **Step 1: Add the types and field list to `src/types.ts`**

Add near the top of the file, before `EngramSyncSettings`:

```ts
/** Which backend this vault syncs to. Explicit state, never inferred from apiUrl. */
export type BackendMode = "cloud" | "selfhost";

/** Fields owned by exactly one backend. Switching backends stashes and restores
 *  precisely this set. `withClearedAuth` clears the credential subset of it.
 *  Both consume this list so the two can never drift: a field added here but
 *  missed there would be cleared on switch and never restored. */
export const BACKEND_SCOPED_FIELDS = [
	"apiUrl",
	"apiKey",
	"refreshToken",
	"userEmail",
	"authMethod",
	"vaultId",
	"remoteVaultName",
	"accessToken",
	"accessTokenExpiresAt",
	"accessTokenVaultId",
] as const;

export type BackendScopedField = (typeof BACKEND_SCOPED_FIELDS)[number];
```

Then add these two fields inside the `EngramSyncSettings` interface, after `featureFlags`:

```ts
	/** Which backend is active. Optional so `migrateBackendMode` can detect a
	 *  pre-migration install. Deliberately absent from DEFAULT_SETTINGS for that
	 *  reason; always present after first load. */
	backendMode?: BackendMode;
	/** The other backend's stashed URL and credentials, so switching modes is
	 *  reversible without re-authenticating. */
	inactiveBackend?: BackendSlot;
```

And after the interface:

```ts
/** One backend's complete configuration. */
export type BackendSlot = Pick<EngramSyncSettings, BackendScopedField>;
```

Do NOT touch `DEFAULT_SETTINGS`.

- [ ] **Step 2: Write the failing test**

Create `tests/backend-mode.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { withClearedAuth } from "../src/auth-state";
import { applySlot, captureSlot } from "../src/backend-mode";
import { BACKEND_SCOPED_FIELDS, type EngramSyncSettings } from "../src/types";

const fullSettings = (override: Partial<EngramSyncSettings> = {}): EngramSyncSettings => ({
	apiUrl: "https://engram.example.com",
	apiKey: "engram_secret123",
	refreshToken: "refresh_abc",
	userEmail: "todd@example.com",
	authMethod: "oauth",
	vaultId: "vault-1",
	remoteVaultName: "My Vault",
	accessToken: "access_xyz",
	accessTokenExpiresAt: 1234567890,
	accessTokenVaultId: "vault-1",
	clientId: "client-uuid",
	ignorePatterns: "node_modules",
	debounceMs: 2000,
	diagnosticsEnabled: false,
	remoteLogLevel: "info",
	searchDefaultMode: "hybrid",
	...override,
});

describe("captureSlot / applySlot", () => {
	test("captures every backend-scoped field", () => {
		const slot = captureSlot(fullSettings());
		for (const key of BACKEND_SCOPED_FIELDS) {
			expect(Object.hasOwn(slot, key)).toBe(true);
		}
		expect(slot.apiUrl).toBe("https://engram.example.com");
		expect(slot.accessTokenExpiresAt).toBe(1234567890);
	});

	test("applySlot mutates in place so live references stay valid", () => {
		const settings = fullSettings();
		const before = settings;
		applySlot(settings, captureSlot(fullSettings({ apiUrl: "https://other.example.com" })));
		expect(settings).toBe(before);
		expect(settings.apiUrl).toBe("https://other.example.com");
	});

	test("round-trip restores every field exactly", () => {
		const original = fullSettings();
		const slot = captureSlot(original);
		const scratch = fullSettings({ apiUrl: "", apiKey: "", refreshToken: undefined });
		applySlot(scratch, slot);
		for (const key of BACKEND_SCOPED_FIELDS) {
			expect(scratch[key]).toEqual(original[key]);
		}
	});
});

describe("drift guard", () => {
	test("every field withClearedAuth clears is backend-scoped", () => {
		const before = fullSettings();
		const after = withClearedAuth(before);
		const cleared = (Object.keys(before) as (keyof EngramSyncSettings)[]).filter(
			(k) => before[k] !== after[k],
		);
		expect(cleared.length).toBeGreaterThan(0);
		for (const key of cleared) {
			expect(BACKEND_SCOPED_FIELDS as readonly string[]).toContain(key);
		}
	});
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/backend-mode.test.ts`
Expected: FAIL, cannot resolve module `../src/backend-mode`.

- [ ] **Step 4: Create `src/backend-mode.ts`**

```ts
import { BACKEND_SCOPED_FIELDS, type BackendSlot, type EngramSyncSettings } from "./types";

/** Read the active backend's fields into a standalone slot. */
export function captureSlot(settings: EngramSyncSettings): BackendSlot {
	const slot = {} as Record<string, unknown>;
	for (const key of BACKEND_SCOPED_FIELDS) {
		slot[key] = settings[key];
	}
	return slot as BackendSlot;
}

/** Write a slot back onto settings IN PLACE. In-place is required, not
 *  stylistic: SyncEngine and the API client hold a reference to this object,
 *  so replacing it would leave them reading a stale backend. Same discipline
 *  as applyApiUrlChange. */
export function applySlot(settings: EngramSyncSettings, slot: BackendSlot): void {
	const target = settings as Record<string, unknown>;
	for (const key of BACKEND_SCOPED_FIELDS) {
		target[key] = slot[key];
	}
}
```

- [ ] **Step 5: Refactor `withClearedAuth` to consume the shared list**

In `src/auth-state.ts`, replace the body of `withClearedAuth` (currently `src/auth-state.ts:76-91`) with:

```ts
/** Credential fields cleared on a backend change. A strict subset of
 *  BACKEND_SCOPED_FIELDS: apiUrl and remoteVaultName are backend-scoped but are
 *  not credentials, so they are stashed on a mode switch rather than wiped. */
const CLEARED_AUTH_FIELDS = [
	"apiKey",
	"refreshToken",
	"userEmail",
	"authMethod",
	"vaultId",
	// The cached access token (plus its expiry and vault binding) is signed by
	// the minting backend and only valid there. Leaving it set lets a backend
	// switch replay a stale token against the new origin, causing signature_error.
	"accessToken",
	"accessTokenExpiresAt",
	"accessTokenVaultId",
] as const satisfies readonly BackendScopedField[];

export function withClearedAuth(settings: EngramSyncSettings): EngramSyncSettings {
	return {
		...settings,
		apiKey: "",
		refreshToken: undefined,
		userEmail: undefined,
		authMethod: null,
		vaultId: null,
		accessToken: undefined,
		accessTokenExpiresAt: undefined,
		accessTokenVaultId: undefined,
	};
}
```

Add `import type { BackendScopedField } from "./types";` to the file's imports. The `satisfies` clause is the compile-time half of the drift guard: a typo or a field not in `BACKEND_SCOPED_FIELDS` fails `tsc`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/backend-mode.test.ts`
Expected: PASS, 4 tests.

Run: `bun test tests/auth-state.test.ts`
Expected: PASS, no regressions.

- [ ] **Step 7: Type-check**

Run: `bun run build`
Expected: no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/backend-mode.ts tests/backend-mode.test.ts src/auth-state.ts
git commit -m "feat(settings): add backend-scoped field list and slot capture

Introduces BACKEND_SCOPED_FIELDS as the single source of truth for which
settings belong to one backend, plus captureSlot/applySlot. withClearedAuth
now type-checks its field list against it via satisfies, so the two cannot
drift silently."
```

---

### Task 2: switchMode and connectionState

**Files:**
- Modify: `src/backend-mode.ts`
- Modify: `tests/backend-mode.test.ts`

**Interfaces:**
- Consumes: `captureSlot`, `applySlot`, `BackendSlot`, `BackendMode` from Task 1
- Produces: `switchMode(settings: EngramSyncSettings, target: BackendMode, cloudUrl: string): boolean`, `connectionState(settings: Pick<EngramSyncSettings, "apiUrl" | "apiKey" | "refreshToken">): ConnectionState`, `type ConnectionState = "connected" | "needs-url" | "needs-auth"`

- [ ] **Step 1: Write the failing tests**

Append to `tests/backend-mode.test.ts`, and extend the existing import from `../src/backend-mode` to also pull in `connectionState` and `switchMode`:

```ts
const CLOUD = "https://api.engram.page";

describe("connectionState", () => {
	test("needs-url when apiUrl is empty", () => {
		expect(connectionState({ apiUrl: "", apiKey: "", refreshToken: undefined })).toBe("needs-url");
	});

	test("needs-auth when a URL is set but no credential", () => {
		expect(connectionState({ apiUrl: CLOUD, apiKey: "", refreshToken: undefined })).toBe(
			"needs-auth",
		);
	});

	test("connected with an apiKey", () => {
		expect(connectionState({ apiUrl: CLOUD, apiKey: "engram_k", refreshToken: undefined })).toBe(
			"connected",
		);
	});

	test("connected with a refreshToken", () => {
		expect(connectionState({ apiUrl: CLOUD, apiKey: "", refreshToken: "r" })).toBe("connected");
	});
});

describe("switchMode", () => {
	test("no-op when already in the target mode", () => {
		const settings = fullSettings({ backendMode: "selfhost" });
		expect(switchMode(settings, "selfhost", CLOUD)).toBe(false);
		expect(settings.apiUrl).toBe("https://engram.example.com");
	});

	test("switching to cloud with no stash seeds the cloud URL and clears credentials", () => {
		const settings = fullSettings({ backendMode: "selfhost" });
		expect(switchMode(settings, "cloud", CLOUD)).toBe(true);
		expect(settings.backendMode).toBe("cloud");
		expect(settings.apiUrl).toBe(CLOUD);
		expect(settings.apiKey).toBe("");
		expect(settings.refreshToken).toBeUndefined();
		expect(connectionState(settings)).toBe("needs-auth");
	});

	test("switching to selfhost with no stash leaves the URL empty", () => {
		const settings = fullSettings({ backendMode: "cloud", apiUrl: CLOUD });
		expect(switchMode(settings, "selfhost", CLOUD)).toBe(true);
		expect(settings.apiUrl).toBe("");
		expect(connectionState(settings)).toBe("needs-url");
	});

	test("round-trip restores the original backend's credentials", () => {
		const settings = fullSettings({ backendMode: "selfhost" });
		switchMode(settings, "cloud", CLOUD);
		settings.apiKey = "cloud_key";
		settings.userEmail = "cloud@example.com";

		switchMode(settings, "selfhost", CLOUD);
		expect(settings.apiUrl).toBe("https://engram.example.com");
		expect(settings.apiKey).toBe("engram_secret123");
		expect(settings.userEmail).toBe("todd@example.com");

		switchMode(settings, "cloud", CLOUD);
		expect(settings.apiKey).toBe("cloud_key");
		expect(settings.userEmail).toBe("cloud@example.com");
	});

	test("mutates settings in place", () => {
		const settings = fullSettings({ backendMode: "selfhost" });
		const before = settings;
		switchMode(settings, "cloud", CLOUD);
		expect(settings).toBe(before);
	});

	test("a stash missing apiUrl is treated as empty, never half-restored", () => {
		const settings = fullSettings({ backendMode: "selfhost" });
		settings.inactiveBackend = { apiKey: "orphan_key" } as never;
		switchMode(settings, "cloud", CLOUD);
		expect(settings.apiUrl).toBe(CLOUD);
		expect(settings.apiKey).toBe("");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/backend-mode.test.ts`
Expected: FAIL, `switchMode` and `connectionState` are not exported.

- [ ] **Step 3: Implement in `src/backend-mode.ts`**

Append:

```ts
import type { BackendMode } from "./types";

export type ConnectionState = "connected" | "needs-url" | "needs-auth";

/** What, if anything, the active backend is still missing. Read by BOTH the
 *  Connection tab banner and the sync guard, so the two cannot disagree about
 *  whether the plugin is usable. */
export function connectionState(
	settings: Pick<EngramSyncSettings, "apiUrl" | "apiKey" | "refreshToken">,
): ConnectionState {
	if (!settings.apiUrl) return "needs-url";
	if (!settings.apiKey && !settings.refreshToken) return "needs-auth";
	return "connected";
}

/** A backend that has never been configured. */
function emptySlot(apiUrl: string): BackendSlot {
	return {
		apiUrl,
		apiKey: "",
		refreshToken: undefined,
		userEmail: undefined,
		authMethod: null,
		vaultId: null,
		remoteVaultName: undefined,
		accessToken: undefined,
		accessTokenExpiresAt: undefined,
		accessTokenVaultId: undefined,
	};
}

/** Swap the active backend for the stashed one. Returns false when already in
 *  the target mode. Non-destructive: the outgoing backend's URL and credentials
 *  are stashed, so switching back needs no re-authentication.
 *
 *  The caller is responsible for tearing down connections bound to the OLD
 *  backend (auth provider, note stream) before persisting. */
export function switchMode(
	settings: EngramSyncSettings,
	target: BackendMode,
	cloudUrl: string,
): boolean {
	if (settings.backendMode === target) return false;

	const outgoing = captureSlot(settings);
	const stash = settings.inactiveBackend;
	// A slot without a string apiUrl is corrupt or partial. Fall back to empty
	// rather than restoring half a backend.
	const incoming =
		stash && typeof stash.apiUrl === "string"
			? stash
			: emptySlot(target === "cloud" ? cloudUrl : "");

	applySlot(settings, incoming);
	// Cloud's URL is fixed and known, so an empty cloud slot is always seeded.
	if (target === "cloud" && !settings.apiUrl) settings.apiUrl = cloudUrl;

	settings.inactiveBackend = outgoing;
	settings.backendMode = target;
	return true;
}
```

Merge the new `import type { BackendMode }` into the existing `./types` import rather than adding a second import statement.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/backend-mode.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/backend-mode.ts tests/backend-mode.test.ts
git commit -m "feat(settings): add switchMode and connectionState

switchMode swaps the active backend with the stashed one in place, so
toggling between Cloud and self-hosted is reversible without signing in
again. connectionState is the single derivation both the UI banner and
the sync guard read."
```

---

### Task 3: Migration on load

**Files:**
- Modify: `src/backend-mode.ts`
- Modify: `tests/backend-mode.test.ts`
- Modify: `src/main.ts:1173` (immediately after the `migrateCloudApiUrl` block)

**Interfaces:**
- Consumes: `BackendMode` from Task 1
- Produces: `migrateBackendMode(settings: EngramSyncSettings, cloudUrl: string): boolean` (returns true when it changed something, so the caller sets its `dirty` flag)

- [ ] **Step 1: Write the failing tests**

Append to `tests/backend-mode.test.ts`, adding `migrateBackendMode` to the `../src/backend-mode` import:

```ts
describe("migrateBackendMode", () => {
	test("infers cloud from a stored cloud URL", () => {
		const settings = fullSettings({ apiUrl: CLOUD });
		settings.backendMode = undefined;
		expect(migrateBackendMode(settings, CLOUD)).toBe(true);
		expect(settings.backendMode).toBe("cloud");
	});

	test("infers selfhost from any other URL", () => {
		const settings = fullSettings({ apiUrl: "https://engram.example.com" });
		settings.backendMode = undefined;
		expect(migrateBackendMode(settings, CLOUD)).toBe(true);
		expect(settings.backendMode).toBe("selfhost");
	});

	test("infers selfhost from an empty URL (fresh install)", () => {
		const settings = fullSettings({ apiUrl: "" });
		settings.backendMode = undefined;
		expect(migrateBackendMode(settings, CLOUD)).toBe(true);
		expect(settings.backendMode).toBe("selfhost");
	});

	test("is a no-op once backendMode is set", () => {
		const settings = fullSettings({ apiUrl: CLOUD, backendMode: "selfhost" });
		expect(migrateBackendMode(settings, CLOUD)).toBe(false);
		expect(settings.backendMode).toBe("selfhost");
	});

	test("never signs anyone out", () => {
		const settings = fullSettings({ apiUrl: CLOUD });
		settings.backendMode = undefined;
		migrateBackendMode(settings, CLOUD);
		expect(settings.apiKey).toBe("engram_secret123");
		expect(settings.refreshToken).toBe("refresh_abc");
		expect(settings.vaultId).toBe("vault-1");
		expect(settings.inactiveBackend).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/backend-mode.test.ts`
Expected: FAIL, `migrateBackendMode` is not exported.

- [ ] **Step 3: Implement in `src/backend-mode.ts`**

Append:

```ts
/** One-time upgrade for installs that predate explicit backendMode. Infers the
 *  mode from the stored apiUrl, which was the old (derived) source of truth.
 *  Credentials are left exactly where they are: nobody is signed out.
 *
 *  MUST run AFTER migrateCloudApiUrl, which normalizes a legacy Cloud host onto
 *  ENGRAM_CLOUD_URL. Running first would read the un-normalized URL and
 *  misclassify a legacy Cloud install as self-hosted. */
export function migrateBackendMode(settings: EngramSyncSettings, cloudUrl: string): boolean {
	if (settings.backendMode === "cloud" || settings.backendMode === "selfhost") return false;
	settings.backendMode = settings.apiUrl === cloudUrl ? "cloud" : "selfhost";
	return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/backend-mode.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Wire into `loadSettings`**

In `src/main.ts`, find this existing block (around line 1173):

```ts
		const migratedUrl = migrateCloudApiUrl(this.settings.apiUrl, ENGRAM_CLOUD_URL);
		if (migratedUrl && migratedUrl !== this.settings.apiUrl) {
			this.settings.apiUrl = migratedUrl;
			dirty = true;
		}
```

Insert immediately after it:

```ts
		// Infer backendMode for installs that predate it. Runs AFTER the URL
		// migration above so a legacy Cloud host is already normalized and gets
		// classified as cloud, not self-hosted.
		if (migrateBackendMode(this.settings, ENGRAM_CLOUD_URL)) {
			dirty = true;
		}
```

Add `migrateBackendMode` to the imports from `./backend-mode` at the top of `src/main.ts`.

- [ ] **Step 6: Type-check and run the full suite**

Run: `bun run build`
Expected: no TypeScript errors.

Run: `bun test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/backend-mode.ts tests/backend-mode.test.ts src/main.ts
git commit -m "feat(settings): migrate existing installs to explicit backendMode

Infers the mode from the stored apiUrl on first load after upgrade, after
the legacy Cloud host rewrite so a legacy Cloud install is not misread as
self-hosted. No credentials are touched and nobody is signed out."
```

---

### Task 4: The Connection tab

**Files:**
- Create: `src/tabs/connection-tab.ts`
- Delete: `src/tabs/account-tab.ts`
- Modify: `src/tabs/self-hosted-tab.ts` (delete `renderSelfHostedTab` and `renderCloudLockBanner`)
- Modify: `src/settings.ts:186-193` (tab list), `src/settings.ts:236` (default tab)
- Modify: `src/tabs/start-tab.ts`
- Modify: `src/tabs/about-tab.ts:89`
- Modify: `tests/start-tab.test.ts` if it exists (check with `ls tests | grep start`)

**Interfaces:**
- Consumes: `switchMode`, `connectionState` from Tasks 2 and 3; `renderEngramUrlSetting`, `renderAuthSection`, `renderVaultSection`, `renderSupportSection` from `src/tabs/self-hosted-tab.ts`; `pluginSwitchTarget` from `src/auth-state.ts`
- Produces: `renderConnectionTab(ctx: TabContext): void`, and a tab id of `"connection"`

- [ ] **Step 1: Create `src/tabs/connection-tab.ts`**

```ts
import { Notice, Setting } from "obsidian";
import { pluginSwitchTarget } from "../auth-state";
import { connectionState, switchMode } from "../backend-mode";
import type { BackendMode } from "../types";
import {
	renderAuthSection,
	renderEngramUrlSetting,
	renderSupportSection,
	renderVaultSection,
} from "./self-hosted-tab";
import type { TabContext } from "./types";
import { ENGRAM_CLOUD_URL, ENGRAM_MARKETING_URL } from "./urls";

const MODE_LABELS: Record<BackendMode, string> = {
	cloud: "Engram Cloud",
	selfhost: "Self-hosted",
};

/** The single Connection tab. Replaces the former Cloud and Self-hosted tabs.
 *
 *  Mode is read from explicit settings.backendMode, never inferred from apiUrl.
 *  That inference is what made merely VISITING the old Cloud tab a mutation
 *  (see the deleted cloudTabAction and PR #162): navigation is now inert, and
 *  only the toggle changes anything. */
export function renderConnectionTab(ctx: TabContext): void {
	const { containerEl, plugin, redisplay } = ctx;
	const mode: BackendMode = plugin.settings.backendMode ?? "selfhost";

	// ponytail: a dropdown, not a custom segmented control. Same two-choice
	// semantics, standard Obsidian affordance, zero new CSS. Swap for segmented
	// buttons only if the visual matters more than the maintenance.
	new Setting(containerEl)
		.setName("Backend")
		.setDesc("Where this vault syncs to. Each backend keeps its own sign-in.")
		.addDropdown((dd) => {
			dd.addOption("cloud", MODE_LABELS.cloud);
			dd.addOption("selfhost", MODE_LABELS.selfhost);
			dd.setValue(mode);
			dd.onChange(async (value) => {
				const target = value as BackendMode;
				if (!switchMode(plugin.settings, target, ENGRAM_CLOUD_URL)) return;
				// Tear down anything bound to the OLD backend before persisting.
				// An access token signed by one backend must never be replayed
				// against another. Same three steps as applyApiUrlChange.
				plugin.api.setAuthProvider(null);
				pluginSwitchTarget(plugin).resetAuthProvider();
				plugin.noteStream?.disconnect();
				await plugin.saveSettings();
				new Notice(`Switched to ${MODE_LABELS[target]}.`);
				redisplay();
			});
		});

	const state = connectionState(plugin.settings);
	if (state !== "connected") {
		const message =
			state === "needs-url"
				? "Not connected. Enter your Engram server URL below to start syncing."
				: "Not connected. Sign in below to start syncing.";
		const warning = new Setting(containerEl).setName(message);
		warning.settingEl.addClass("engram-connection-warning");
	}

	if (mode === "cloud") {
		const about = new Setting(containerEl)
			.setName("New to Engram?")
			.setDesc("Create an account, read the docs, and learn more at ");
		about.settingEl.addClass("engram-setup-cta");
		about.descEl.createEl("a", {
			text: "engram.page",
			href: ENGRAM_MARKETING_URL,
			attr: { target: "_blank", rel: "noopener" },
		});
		about.descEl.appendText(".");
	} else {
		const repo = new Setting(containerEl)
			.setName("Run your own Engram server")
			.setDesc("Engram is the backend that powers sync and semantic search.");
		repo.settingEl.addClass("engram-setup-cta");
		repo.descEl.addClass("engram-server-cta-desc");
		repo.descEl.createEl("a", {
			text: "github.com/engram-app/engram",
			href: "https://github.com/engram-app/engram",
		});
		renderEngramUrlSetting(ctx);
	}

	renderAuthSection(ctx);
	renderVaultSection(ctx);
	if (mode === "selfhost") renderSupportSection(ctx);
}
```

- [ ] **Step 2: Add the warning style**

Append to `styles.css`:

```css
.engram-connection-warning .setting-item-name {
	color: var(--text-warning);
}
```

- [ ] **Step 3: Delete the superseded renderers**

In `src/tabs/self-hosted-tab.ts`:
- Delete the entire `renderSelfHostedTab` function (currently lines 15 to 42).
- Delete the entire `renderCloudLockBanner` function.
- Keep `renderEngramUrlSetting`, `renderAuthSection`, `renderVaultSection`, `renderSupportSection`.
- Remove now-unused imports (`ENGRAM_CLOUD_URL` may become unused; let Biome tell you).

Delete the file `src/tabs/account-tab.ts` entirely:

```bash
git rm src/tabs/account-tab.ts
```

`account-tab.ts` re-exported `ENGRAM_CLOUD_URL` and `ENGRAM_MARKETING_URL`. Check for importers and repoint them at `./urls`:

```bash
grep -rn "from \"./account-tab\"\|from \"../tabs/account-tab\"\|account-tab" src/ tests/
```

- [ ] **Step 4: Update the tab list in `src/settings.ts`**

Replace the two tab entries at `src/settings.ts:189-190`:

```ts
			{ id: "account" as const, label: "☁️ Cloud", render: renderAccountTab },
			{ id: "self-hosted" as const, label: "🖥️ Self-hosted", render: renderSelfHostedTab },
```

with the single entry:

```ts
			{ id: "connection" as const, label: "🔌 Connection", render: renderConnectionTab },
```

At `src/settings.ts:236`, change the fallback tab id:

```ts
		const startTab = tabs.find((t) => t.id === this.activeTab) ? this.activeTab : "connection";
```

Update the imports: drop `renderAccountTab` and `renderSelfHostedTab`, add `renderConnectionTab` from `./tabs/connection-tab`.

- [ ] **Step 5: Update `pickInitialTab`**

Replace the body of `src/tabs/start-tab.ts`:

```ts
/** Choose which settings tab to show when the panel first opens.
 *
 *  New users (no backend configured) land on the Welcome page so they get
 *  oriented; anyone already connected opens straight on the Connection tab.
 *  Pure so it can be unit-tested without the Obsidian DOM. */
export function pickInitialTab(settings: {
	apiUrl?: string;
	apiKey?: string;
	refreshToken?: string;
}): "about" | "connection" {
	const configured = !!settings.apiUrl && (!!settings.apiKey || !!settings.refreshToken);
	return configured ? "connection" : "about";
}
```

In `src/tabs/about-tab.ts:89`, change `switchToTab("account")` to `switchToTab("connection")`.

- [ ] **Step 6: Update any existing start-tab test**

Run: `ls tests | grep -i start`

If `tests/start-tab.test.ts` exists, replace every expected `"account"` with `"connection"`. If it does not exist, skip this step.

- [ ] **Step 7: Type-check, lint, and run the suite**

Run: `bun run build`
Expected: no TypeScript errors, no unused imports.

Run: `bun run lint`
Expected: no Biome findings.

Run: `bun run lint:css`
Expected: no Stylelint findings.

Run: `bun test`
Expected: PASS. `tests/auth-state.test.ts` will still pass at this point because `cloudTabAction` is not removed until Task 6.

- [ ] **Step 8: Manual smoke in Obsidian**

Open the plugin settings. Verify:
1. The tab bar shows exactly four tabs: Welcome, Connection, Sync Center, Advanced.
2. On Connection, the Backend dropdown reflects the current mode.
3. Switching to Self-hosted with no prior self-hosted config shows an empty URL box and the "Enter your Engram server URL" warning, NOT the Cloud URL. This is the originally reported bug.
4. Switching back to Cloud restores the Cloud sign-in without prompting for credentials again.

- [ ] **Step 9: Commit**

```bash
git add src/tabs/connection-tab.ts src/tabs/self-hosted-tab.ts src/settings.ts src/tabs/start-tab.ts src/tabs/about-tab.ts styles.css tests/
git rm --cached src/tabs/account-tab.ts 2>/dev/null || true
git commit -m "feat(settings): merge Cloud and Self-hosted into one Connection tab

Mode now comes from explicit settings.backendMode instead of comparing
apiUrl to the Cloud URL, so the Self-hosted URL box no longer pre-fills
with the Cloud URL after disconnecting. Switching backends is reversible:
each keeps its own URL and credentials."
```

---

### Task 5: Reject unparseable URLs on Save

**Files:**
- Modify: `src/auth-state.ts:164-181` (`applyApiUrlChange`)
- Modify: `src/tabs/self-hosted-tab.ts` (the Save button handler in `renderEngramUrlSetting`)
- Modify: `tests/auth-state.test.ts`

**Interfaces:**
- Consumes: `completeOrigin` from `src/auth-state.ts`
- Produces: `applyApiUrlChange` now returns `{ cleared: boolean; rejected: boolean }` instead of a bare `boolean`

- [ ] **Step 1: Write the failing tests**

Append to `tests/auth-state.test.ts`:

```ts
describe("applyApiUrlChange rejects unusable URLs", () => {
	const target = (settings: EngramSyncSettings): ApiUrlSwitchTarget => ({
		settings,
		api: { setAuthProvider: mock(() => {}) } as never,
		noteStream: { disconnect: mock(() => {}) } as never,
		resetAuthProvider: mock(() => {}),
	});

	test("rejects a URL with no scheme and leaves the stored URL untouched", async () => {
		const settings = fullSettings({ apiUrl: "https://engram.example.com" });
		const result = await applyApiUrlChange(target(settings), "localhost:4000", async () => {});
		expect(result.rejected).toBe(true);
		expect(settings.apiUrl).toBe("https://engram.example.com");
	});

	test("rejects a partial URL", async () => {
		const settings = fullSettings({ apiUrl: "https://engram.example.com" });
		const result = await applyApiUrlChange(target(settings), "https://engr", async () => {});
		expect(result.rejected).toBe(true);
		expect(settings.apiUrl).toBe("https://engram.example.com");
	});

	test("rejects an empty URL", async () => {
		const settings = fullSettings({ apiUrl: "https://engram.example.com" });
		const result = await applyApiUrlChange(target(settings), "", async () => {});
		expect(result.rejected).toBe(true);
		expect(settings.apiUrl).toBe("https://engram.example.com");
	});

	test("accepts a complete URL and reports whether auth was cleared", async () => {
		const settings = fullSettings({ apiUrl: "https://engram.example.com" });
		const result = await applyApiUrlChange(
			target(settings),
			"http://127.0.0.1:4000",
			async () => {},
		);
		expect(result.rejected).toBe(false);
		expect(result.cleared).toBe(true);
		expect(settings.apiUrl).toBe("http://127.0.0.1:4000");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/auth-state.test.ts`
Expected: FAIL, `result.rejected` is undefined because the function returns a boolean.

- [ ] **Step 3: Change the return shape**

Replace `applyApiUrlChange` in `src/auth-state.ts`:

```ts
/** Outcome of a URL change. `rejected` means nothing was written: the value did
 *  not parse as a complete origin. Previously such a value was stored silently,
 *  leaving apiUrl set to something no downstream consumer could use. */
export interface ApiUrlChangeResult {
	cleared: boolean;
	rejected: boolean;
}

export async function applyApiUrlChange(
	target: ApiUrlSwitchTarget,
	newUrl: string,
	save: () => Promise<void>,
): Promise<ApiUrlChangeResult> {
	if (target.settings.apiUrl === newUrl) return { cleared: false, rejected: false };
	// Refuse anything that is not a complete origin. Storing it would leave the
	// plugin pointed at an unusable address with no error shown.
	if (!completeOrigin(newUrl)) return { cleared: false, rejected: true };

	const cleared = isBackendChange(target.settings.apiUrl, newUrl);
	if (cleared) {
		// Mutate in place, withClearedAuth is the single source of truth for
		// which fields are backend-scoped, so any future addition stays one-place.
		Object.assign(target.settings, withClearedAuth(target.settings));
		target.api.setAuthProvider(null);
		target.resetAuthProvider();
		target.noteStream?.disconnect();
	}
	target.settings.apiUrl = newUrl;
	await save();
	return { cleared, rejected: false };
}
```

- [ ] **Step 4: Update the Save button handler**

In `src/tabs/self-hosted-tab.ts`, inside `renderEngramUrlSetting`, replace the `onClick` body:

```ts
				.onClick(async () => {
					const { cleared, rejected } = await applyApiUrlChange(
						pluginSwitchTarget(plugin),
						pendingUrl.trim(),
						() => plugin.saveSettings(),
					);
					if (rejected) {
						new Notice(
							"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000",
						);
						return;
					}
					if (cleared) {
						new Notice("Engram backend changed. Sign in again to continue.");
					}
					redisplay();
				}),
```

Note the `return` on rejection: the tab is NOT redisplayed, so the user's typed value stays in the box for correction.

- [ ] **Step 5: Fix other call sites**

Find every other caller and unpack the new shape:

```bash
grep -rn "applyApiUrlChange" src/ tests/
```

`account-tab.ts` was deleted in Task 4, so the remaining callers should be `self-hosted-tab.ts` and the tests.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/auth-state.test.ts`
Expected: PASS.

Run: `bun run build`
Expected: no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/auth-state.ts src/tabs/self-hosted-tab.ts tests/auth-state.test.ts
git commit -m "fix(settings): reject unparseable server URLs instead of storing them

An address like localhost:4000 has no scheme, so completeOrigin returns
null: isBackendChange was false, auth survived, and apiUrl was set to a
value nothing downstream could use, with no error shown. Save now refuses
it, keeps the stored URL, and leaves the typed value in the box."
```

---

### Task 6: Delete cloudTabAction and add the sync guard

**Files:**
- Modify: `src/auth-state.ts` (delete `cloudTabAction`)
- Modify: `tests/auth-state.test.ts` (delete its tests)
- Modify: `src/sync.ts:6449-6453` (`fullSyncInner`)

**Interfaces:**
- Consumes: `connectionState` from Task 2
- Produces: nothing new

- [ ] **Step 1: Delete `cloudTabAction`**

In `src/auth-state.ts`, delete the entire `cloudTabAction` function and its doc comment (the block ending at line 137). It has no callers left: its only consumer was `account-tab.ts`, deleted in Task 4.

Verify:

```bash
grep -rn "cloudTabAction" src/ tests/
```

- [ ] **Step 2: Delete its tests**

In `tests/auth-state.test.ts`, delete the entire `describe("cloudTabAction", ...)` block and remove `cloudTabAction` from the import list.

- [ ] **Step 3: Run the suite**

Run: `bun test tests/auth-state.test.ts`
Expected: PASS.

Run: `bun run build`
Expected: no TypeScript errors, no unused imports.

- [ ] **Step 4: Write the failing sync-guard test**

Create `tests/sync-connection-guard.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { connectionState } from "../src/backend-mode";

/** The guard in fullSyncInner is a thin wrapper over connectionState. These
 *  pin the decision table the guard encodes, without booting a SyncEngine. */
describe("sync connection guard decision table", () => {
	test("blocks when no URL is configured", () => {
		expect(connectionState({ apiUrl: "", apiKey: "k", refreshToken: undefined })).not.toBe(
			"connected",
		);
	});

	test("blocks when a URL is set but no credential", () => {
		expect(
			connectionState({ apiUrl: "https://engram.example.com", apiKey: "", refreshToken: undefined }),
		).not.toBe("connected");
	});

	test("allows when both are present", () => {
		expect(
			connectionState({ apiUrl: "https://engram.example.com", apiKey: "k", refreshToken: undefined }),
		).toBe("connected");
	});
});
```

- [ ] **Step 5: Run it**

Run: `bun test tests/sync-connection-guard.test.ts`
Expected: PASS immediately. `connectionState` already exists from Task 2; this test documents the contract the guard depends on.

- [ ] **Step 6: Add the guard in `src/sync.ts`**

In `fullSyncInner` (around line 6449), insert a SECOND independent guard immediately after the existing `syncBlocked` check:

```ts
	private async fullSyncInner(): Promise<{ pulled: number; pushed: number }> {
		if (this.syncBlocked) {
			devLog().log("sync-blocked", "fullSync short-circuited — gate closed");
			return { pulled: 0, pushed: 0 };
		}
		// Separate from syncBlocked ON PURPOSE. syncBlocked is owned by the
		// terms/onboarding gate; a second writer of that flag would race it.
		// This is a read-only derivation of the current settings instead.
		if (connectionState(this.settings) !== "connected") {
			devLog().log("sync-blocked", "fullSync short-circuited, no backend configured");
			return { pulled: 0, pushed: 0 };
		}
```

Leave the existing em dash in the pre-existing `sync-blocked` string alone: it is not new prose and rewriting untouched lines widens the diff.

Add `connectionState` to the imports at the top of `src/sync.ts` from `./backend-mode`.

`SyncEngine` already holds `private settings: EngramSyncSettings` (`src/sync.ts:1746`) and exposes `updateSettings` (`src/sync.ts:1766`), so `this.settings` is live and reflects a mode switch as soon as the Connection tab saves. No new field is needed.

- [ ] **Step 7: Run the full suite and lints**

Run: `bun test`
Expected: PASS.

Run: `bun run build && bun run lint && bun run lint:obsidian && bun run lint:css`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add src/auth-state.ts src/sync.ts tests/auth-state.test.ts tests/sync-connection-guard.test.ts
git commit -m "refactor(settings): delete cloudTabAction, guard sync on connection state

cloudTabAction existed only to stop tab navigation from mutating
credentials, which explicit backendMode makes impossible. fullSync now
also short-circuits when no backend is configured, as a read-only
derivation rather than a second writer of the syncBlocked flag."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `BACKEND_SCOPED_FIELDS` single source of truth, drift guard | Task 1 |
| `captureSlot` / `applySlot`, in-place mutation | Task 1 |
| `switchMode`, empty-slot defaults, corrupt-slot handling | Task 2 |
| `connectionState` | Task 2 |
| `migrateBackendMode`, ordering after `migrateCloudApiUrl` | Task 3 |
| Connection tab UI, toggle flow, teardown steps | Task 4 |
| Tab-bar reduction to four, `pickInitialTab`, `about-tab` link | Task 4 |
| Deletions: `account-tab.ts`, `renderCloudLockBanner`, `renderSelfHostedTab` | Task 4 |
| Buffered Save button preserved | Task 4 (untouched) and Task 5 |
| Unparseable URL rejection | Task 5 |
| `cloudTabAction` deletion | Task 6 |
| Sync gate | Task 6 |
| Toggle mid-sync tears down the note stream | Task 4 Step 1 |

**Known deviations from the spec, called out deliberately:**

1. **Dropdown instead of a segmented control.** The spec's mockup showed two segments. A two-option `addDropdown` has identical semantics, is the standard Obsidian affordance, and needs no new CSS. Marked with a `ponytail:` comment naming the upgrade path. Flag this at review if the segmented visual matters.
2. **`self-hosted-tab.ts` keeps its filename** while no longer being a tab. Renaming to `connection-sections.ts` is clean-up worth doing separately; bundling it here would bury the behavioral diff under a large rename.

**Placeholder scan:** none. Every code step carries the literal code to write, and every test step carries the assertions.

**Type consistency:** `switchMode(settings, target, cloudUrl)` takes `cloudUrl` in Task 2's implementation, Task 2's tests, and Task 4's call site. `applyApiUrlChange` returns `ApiUrlChangeResult` in Task 5's implementation, its tests, and its single remaining call site. `connectionState` has the same `Pick<...>` parameter type in Tasks 2, 4, and 6.

**Verified against source while writing this plan:** every `file:line` reference above was checked against the current tree, including `settings.ts:189-190`, `settings.ts:236`, `about-tab.ts:89`, `main.ts:1149`, `main.ts:1173`, `sync.ts:6449`, and `sync.ts:1746`. Re-check them if `origin/main` has moved before you start.

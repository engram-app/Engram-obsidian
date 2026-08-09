# Plugin Connection Tab and Explicit Backend Mode: Design

_Date: 2026-08-08_
_Repo: `engram-app/Engram-obsidian` (local dir `engram-obsidian-sync`)_
_Status: design approved, not yet implemented_

> Also written to the Engram vault at
> `50 Engineering/_Superpowers Specs/2026-08-08-plugin-connection-tab-backend-mode-design.md`
> per workspace CLAUDE.md. Kept here as well because vault reads were failing to
> return the note on 2026-08-08 (`write_note` reported success, `get_note` and
> `list_folder` did not reflect it). Treat the vault copy as canonical once
> readable.

## Problem

The plugin has no stored notion of "which backend am I using". Mode is **derived** from a string:

```ts
const isOnCloud = plugin.settings.apiUrl === ENGRAM_CLOUD_URL;
```

One `apiUrl` field serves both Cloud and Self-hosted. Everything below follows from that:

1. **Stale pre-fill (reported 2026-08-08).** `withClearedAuth` clears eight auth fields but never
   `apiUrl`, which is correct: a URL is not a credential. So after disconnecting from Cloud, the
   Self-hosted tab's URL box pre-fills with `https://api.engram.page`. It looks like the plugin is
   insisting on the old backend.
2. **`cloudTabAction` is scar tissue.** It exists solely to decide whether *visiting* the Cloud tab
   should silently adopt the cloud URL (`auto-switch`), prompt (`prompt-switch`), or do nothing.
   It was added after a real regression (PR #162, e2e apiKey-wipe, test_65 → test_69 cascade) in
   which a self-hosted user merely navigating to the Cloud tab had credentials destroyed.
   Navigation should never be a mutation.
3. **An unrepresentable state.** "Self-hosted, no URL chosen yet" cannot be expressed. That is
   precisely why the box falls back to Cloud's URL.
4. **Save accepts junk.** `applyApiUrlChange` stores an unparseable URL (`localhost:4000`) without
   complaint: `completeOrigin` returns null so `isBackendChange` is false and auth survives, but
   `apiUrl` is set to a value nothing downstream can use, with no error shown.

Note the pages are **not** near-duplicates in code. `account-tab.ts` is ~60 lines that already
imports `renderAuthSection` / `renderVaultSection` from `self-hosted-tab.ts`. The duplication is
in the UX, not the source. Merging deletes little code by itself; the value is in removing the
derived-state inference and the machinery built around it.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Toggle semantics | Switches active backend **immediately** | What you see is what's connected |
| Credentials | **Per-mode slots** | Makes the immediate switch non-destructive and reversible, no confirm dialog needed |
| Tabs | Cloud + Self-hosted → one **Connection** tab | Bar becomes Welcome / Connection / Sync Center / Advanced |
| Unconfigured mode | **Pause sync**, show what's missing | Makes the unrepresentable state real |
| Storage shape | **Flat active fields + one stashed slot** (Approach B) | Same behavior as a nested per-mode object, a fraction of the diff, does not touch the sync read path |

### Approach B over A

Approach A (`backends: { cloud: {...}, selfhost: {...} }`) is more obviously correct: the modes
cannot contaminate each other structurally. It was rejected for now because every read site of
`settings.apiUrl` / `settings.apiKey` changes: SyncEngine, `EngramApi`, `device-flow-modal.ts`,
`noteStream`, migrations. That is a wide diff through the sync path while a separate data-loss bug
is open and 1.20.1 is in the wild.

B keeps the flat fields as the active backend, so all downstream consumers are untouched. The
tradeoff: flat fields become a cache of "whichever mode is active", so correctness rests on the
swap being atomic. It is: one `saveSettings()` writes `data.json` once. B → A is a mechanical
follow-up if structural isolation is later wanted.

## Data model

```ts
// src/backend-mode.ts
export const BACKEND_SCOPED_FIELDS = [
  "apiUrl", "apiKey", "refreshToken", "userEmail", "authMethod",
  "vaultId", "remoteVaultName",
  "accessToken", "accessTokenExpiresAt", "accessTokenVaultId",
] as const;

export type BackendMode = "cloud" | "selfhost";
export type BackendSlot = Pick<EngramSyncSettings, typeof BACKEND_SCOPED_FIELDS[number]>;
```

Added to `EngramSyncSettings`:

```ts
backendMode: BackendMode;        // explicit; no longer inferred from apiUrl
inactiveBackend?: BackendSlot;   // the other mode's stashed config
```

**Single source of truth.** `withClearedAuth` already carries the comment *"the single source of
truth for which fields are backend-scoped, so any future addition stays one-place."* The slot must
capture exactly that field set plus `apiUrl` and `remoteVaultName`. If the two lists drift, a
future backend-scoped field is cleared on switch but never stashed, and silently vanishes when the
user toggles back. Both must consume `BACKEND_SCOPED_FIELDS`, and a unit test guards the match.

## Module: `src/backend-mode.ts`

Pure, no Obsidian imports, so it unit-tests without the DOM stack. Same pattern as `auth-state.ts`.

| Function | Responsibility |
|---|---|
| `captureSlot(settings): BackendSlot` | Read backend-scoped fields into a slot |
| `applySlot(settings, slot): void` | Write a slot back **in place** |
| `switchMode(settings, target, cloudUrl): boolean` | Swap active ↔ `inactiveBackend`; returns whether anything changed |
| `migrateBackendMode(settings, cloudUrl): void` | One-time: infer mode from stored `apiUrl` |
| `connectionState(settings)` | `"connected" \| "needs-url" \| "needs-auth"` |

`cloudUrl` is a parameter, not an import, on both functions. It keeps the module free of
`tabs/urls.ts` and lets tests pin the value. `switchMode` needs it to seed `apiUrl` when the
cloud slot is empty.

**In-place mutation is required, not stylistic.** `applyApiUrlChange` mutates deliberately: *"so
external references (SyncEngine, etc.) keep observing the same object."* `switchMode` must follow
suit or SyncEngine holds a stale settings object after every toggle.

**Empty-slot defaults on switch:**
- → `cloud` with no stash: `apiUrl = ENGRAM_CLOUD_URL` (fixed and known)
- → `selfhost` with no stash: `apiUrl = ""`, the previously unrepresentable state, and what stops
  the stale Cloud URL appearing

`connectionState` is read by both the UI banner and the sync gate, so "what's missing" cannot
disagree between them.

## UI: `src/tabs/connection-tab.ts`

Rendered top to bottom:

1. **Backend toggle**, two-segment control bound to `backendMode`
2. **Connection status**, from `connectionState`; rendered only when not `"connected"`
3. **URL field**, self-hosted only. Cloud shows a static "Engram Cloud (api.engram.page)" line
4. **Authentication**, existing `renderAuthSection`, unchanged
5. **Vault**, existing `renderVaultSection`, unchanged
6. **Support / repo CTA**, self-hosted only

The URL field keeps its **buffered Save button**. Not incidental: per-keystroke commit previously
called `applyApiUrlChange` on every character, clearing auth and redisplaying the tab mid-edit,
destroying the input and stealing focus. Preserve the buffered pattern.

### Toggle flow

```
user clicks other segment
  → switchMode(settings, target, cloudUrl)   // capture active → stash; restore other slot in place
  → plugin.api.setAuthProvider(null)
  → plugin.resetAuthProvider()
  → plugin.noteStream?.disconnect()
  → saveSettings()
  → redisplay()
```

No confirm dialog and no credential wipe. That is what per-mode slots buy. The three teardown
steps are lifted from `applyApiUrlChange`'s `cleared` branch and are required for the same reason:
an access token signed by one backend must never be replayed against another.

`applyApiUrlChange` is retained for the Save button, but its scope narrows to "the self-hosted URL
changed while in self-hosted mode."

## Sync gate

`connectionState(settings) !== "connected"` blocks sync and surfaces as a distinct status, not an
error. `renderStatus` already models a non-error waiting state (*"Connected, waiting for first
sync decision"*); this adds *"Not connected, <what's missing>"*. Being unconfigured is a normal
state, not a failure.

## Deletions

- `cloudTabAction` and all three branches, plus its call sites
- `renderCloudLockBanner`
- `src/tabs/account-tab.ts` (folded into the Connection tab)
- the `isOnCloud` inference at `self-hosted-tab.ts:21`
- `pickInitialTab` simplifies, no longer chooses between two auth tabs

`migrateCloudApiUrl` is **retained**: it handles the legacy `app.engram.page` → `api.engram.page`
rewrite, which is about edge hostnames, not mode.

## Migration

In `main.ts` `loadSettings`, **after** the existing `migrateCloudApiUrl` call, order matters, the
URL must be normalized before mode is inferred from it:

- `apiUrl === ENGRAM_CLOUD_URL` → `backendMode: "cloud"`
- anything else, including empty → `backendMode: "selfhost"`
- credentials stay in the active fields; `inactiveBackend` starts `undefined`
- no user is signed out

## Error handling

- **Unparseable URL on Save**, reject with an inline message and leave the stored URL untouched.
  Fixes the existing bug where junk is silently persisted.
- **Toggle mid-sync**, `noteStream.disconnect()` before the swap; in-flight requests fail closed
  against the old backend rather than being retried against the new one.
- **Corrupt/partial `inactiveBackend`**, a slot missing `apiUrl` is treated as empty and falls
  through to `needs-url`, never restored as a half-slot.

## Testing

Unit, pure, `tests/backend-mode.test.ts`:

- round-trip: cloud → selfhost → cloud restores the original credentials exactly
- switching to an unconfigured mode yields `needs-url` (selfhost) / `needs-auth` (cloud)
- **drift guard**: the `BACKEND_SCOPED_FIELDS` list matches `withClearedAuth`'s field set. This is
  the test to insist on, the drift failure silently eats a field on toggle and stays invisible
  until someone adds a backend-scoped setting months later
- migration: cloud URL → `cloud`; self-host URL → `selfhost`; empty → `selfhost`; no credentials lost
- `applySlot` mutates in place (same object identity), so SyncEngine's reference stays live
- Save rejects `localhost:4000`, `https://engr`, `""` and leaves the stored URL unchanged

## Out of scope

- Approach A's nested per-mode storage (mechanical follow-up if wanted)
- The `crdt_create` cross-vault id-reuse data-loss bug, tracked separately in
  `engram/docs/context/crdt-create-cross-vault-id-reuse.md`
- Any change to `renderAuthSection` / `renderVaultSection` internals

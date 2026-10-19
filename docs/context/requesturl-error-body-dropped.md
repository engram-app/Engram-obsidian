# Context Doc: requestUrl drops the error body

_Last verified: 2026-10-19_

## Status
Fixed in commit 4cd9ed48 (branch `fix/stop-on-426`).

## What This Is
Obsidian's `requestUrl` with the default `throw: true` rejects any status >= 400 with `new Error("Request failed, status N")` that carries only `status` and `headers`. There is no `.json` and no `.text` (verified in Obsidian 1.12.7 `app.js`).

## Impact
Every path that read `err.json` / `err.text` saw `{}` in real Obsidian:
- 426 `plugin_upgrade_required` latch (`noteIfUpgradeRequired`) never engaged
- 402 `parseLimitExceededError`
- 409 version conflict handling
- issue-store `extractServerMessage`

Unit tests passed the whole time because mocks rejected with `{status, json}`, a shape real Obsidian never produces.

## Fix
`EngramApi.sendRequest` (`src/api.ts`) sends `throw: false` and pipes the response through `throwIfHttpError`, which rebuilds the same rejection (`status`, `headers`) plus the raw `text`. Callers parse the body from `text`.

## Gotchas
- Test mocks must RESOLVE with a real-shaped response (`status`, `headers`, `text`), not reject with a body. A mock that rejects with `{status, json}` hides this bug class.
- Any new direct `requestUrl` call that needs the error body must also pass `throw: false` and check `status` itself (see `src/device-flow-modal.ts`, `src/update-check.ts`).

## References
- `src/api.ts` (`sendRequest`, `throwIfHttpError`)
- `src/upgrade-required.ts`
- `tests/upgrade-required.test.ts`, `tests/api.test.ts`

# Logging architecture

_Last verified: 2026-10-03_

## Layers

- **`devLog()`** (`src/dev-log.ts`): in-memory ring buffer, queryable over CDP as `__engramLog` (`dump(n)`, `filter(s)`, `stats()`, `clear()`). `DEV_MODE` is replaced with `false` by esbuild, so production builds carry no-ops. Uses `console.debug`, hidden by default in Obsidian's console (needs Verbose).
- **`rlog()`** (`src/remote-log.ts`): ships to the backend `/logs` endpoint, batched (30s timer, 20-entry threshold). Levels error/warn/info (`debug` is reserved, no call sites). Shipping is gated by the single `diagnosticsEnabled` setting (default OFF; it also turns on the verbose `diagnostics.ts` firehose and tracing headers) and by `remoteLogLevel`, a volume dial below which entries are dropped before buffering.
- **`rlog().anomaly(category, code, counts)`**: the one path that ships at warn EVEN WITH DIAGNOSTICS OFF and bypasses the level threshold. It exists because a user's first sync is the most likely thing to break and the least likely to have diagnostics on (prod 2026-08-13: a first sync dropped 316 of 316 notes and produced zero client log lines). Its contract is enforced, not conventional: `category` and `code` are slug-validated and `counts` holds numbers and booleans, so a path, title or note content cannot be expressed in any argument. The category slug matters because the backend interpolates it into a Logger message body (`[client:<category>]`) that the redaction filter does not touch and that ships to Loki at warn. Free text plus a redactor was rejected: a redactor splitting on whitespace leaves part of `Divorce settlement draft.md` intact, and a note title is prose.
- **`noteRef(path)`** (`src/note-ref.ts`): opaque per-session counter used in log lines in place of any path. Never log a cleartext path or note content.
- **`console.error`**: a handful of direct `console.*` calls remain at error boundaries (each carries a `biome-ignore lint/suspicious/noConsole`). New code should log through `rlog()`; a unified logger wrapper was proposed and never built.

## Reading client logs

Client entries land in the backend log as `[client:<category>]` (Loki `category="client"`). Only warn and above reach Loki from the client by default, so an info-level line you are looking for will not be there. Ordering and CI-artifact notes: `crdt-pull-gated-by-create-ack.md`.

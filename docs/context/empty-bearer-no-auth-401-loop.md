# Context Doc: `Bearer ` with no token → `reason=no_auth` 401 loops

_Last verified: 2026-08-02_

## Status
**Fixed and confirmed fixed in prod** — plugin PR #336 (`fix/no-empty-bearer-requests`, merged 2026-07-26), delivered to users in **v1.19.0** (2026-08-01 07:28Z). The fix is only in v1.19.0 and later; a client still storming is a client that has not updated.

Measured on the last affected install (`80.30.60.217`, ES):

| window | its 401s |
|--------|----------|
| 2026-08-01 02:24–02:30Z (pre-release) | **285** |
| 2026-08-01 08:00Z → 08-02 05:00Z (21h, post-release) | **3** |

> ⚠️ **Two things changed on 2026-08-02 that invalidate the recipes below.** Read
> "Attribution after 2026-08-02" before running anything in this doc.

## Symptom
`engram-prod-loki-auth-failure-burst` (Grafana uid `cfq15flt31a0wd`, threshold `>20` warn/error `category=auth` lines per 10m) fires several times a day, values clustered just over threshold (21–102). Reads like credential stuffing. Isn't.

**That rule no longer fires on this** — `metadata_reason!="no_auth"` was excluded from it (engram-infra#894) because 2,959 of 2,967 matches over 7d were protocol-normal MCP OAuth discovery. The storm case is covered by a separate rule, **`auth-no-auth-storm`** (`>50` no_auth per 10m, `notify`), added in engram-infra#896 precisely so excluding no_auth from the security rule did not leave this failure mode unwatched. Baseline is ~2/10m; the 2026-08-01 burst evaluated to 283.

## The mechanism (the reusable part)
An empty bearer token and a garbage bearer token log **different reasons**, and the difference is the whole diagnosis:

| Authorization header | logged `metadata_reason` |
|---|---|
| `Bearer ` (empty token) | `no_auth` |
| `Bearer abc` (garbage) | `signature_error` |
| absent | `no_auth` |

Why: HTTP strips trailing whitespace from field values (RFC 9110 §5.5), so `Bearer ` arrives as the bare string `Bearer`. That misses the `["Bearer " <> token]` clause in `EngramWeb.Plugs.Auth.authenticate/1` (`engram/lib/engram_web/plugs/auth.ex`) and falls to `{:error, :no_auth}`.

So **`no_auth` from a client that clearly has an Authorization header means an empty credential, not a missing header.** Sentry's `PlugContext` scrubs the `authorization` key out of the logged `__sentry__.request.headers` map, so you cannot tell by looking — absence of the key proves nothing. `X-Vault-ID` / `X-Device-Id` are *not* scrubbed, and their absence is real signal (an unlinked install has no vault).

Confirm it in one shot instead of reasoning about it:
```bash
curl -s -o /dev/null -H "Authorization: Bearer " -H "User-Agent: engram-diag-emptytoken-probe" https://api.engram.page/api/me
```
then read the reason back out of Loki (see the recipes below).

## Root cause (plugin)
`src/api.ts` `getAuthToken()` returned `this.apiKey` when `authProvider` was null. For an OAuth install that field is `""`. `authProvider` gets nulled by:
- `main.ts` `clearAuthAndPromptRelink()` — the server definitively rejected the stored refresh token, or a manual Disconnect
- `auth-state.ts` `applyApiUrlChange()` — a backend switch

Nothing gated sync, remote logging or the beacon on auth state (`grep isAuthenticated() src/main.ts src/sync.ts` → zero guards), so the install kept firing requests forever, each one an instant 401 plus a warn log line.

**Self-amplifying:** two of the looping endpoints are `/api/logs` and `/api/telemetry/spans` — the client's own error reporting. It reports that it can't authenticate, that report is rejected, and the rejection is itself a `category=auth` warn line. In the 24h sampled, 200 of 890 lines were the observability channel complaining about itself.

**Fix:** `getAuthToken()` throws on an empty credential (one guard on the shared request path, covers every caller), and the beacon transport thunk drops its batch while `lastToken` is empty — the beacon posts with `window.fetch`, so it bypasses that path.

## Triage recipes

Break the burst down by reason + file first — `no_auth` vs `signature_error` splits "empty credential" from "wrong key":
```logql
sum by (reason, file) (count_over_time(
  {service="engram", env="prod"} | json
  | metadata_category="auth" | severity=~"warning|error"
  | label_format reason=`{{.metadata_reason}}`, file=`{{.metadata_file}}` [24h]))
```

Attribute to a client. Bracket syntax is required for hyphenated JSON keys, and the `__sentry__` blob is only reachable with a second `json` stage:
> 🚫 **DEAD as of 2026-08-02.** Kept only so you recognise it and stop.
> ```logql
> sum by (ip, country) (count_over_time(
>   {service="engram", env="prod"} | json
>   | metadata_category="auth" | metadata_reason="no_auth"
>   | json ip="metadata.__sentry__.request.headers[\"cf-connecting-ip\"]",
>          country="metadata.__sentry__.request.headers[\"cf-ipcountry\"]" [24h]))
> ```
> Returns **nothing** on logs after 2026-08-02. See below.

### Attribution after 2026-08-02

Engram#1196 stopped serializing the `__sentry__` blob into log lines
(`metadata: {:all_except, [:__sentry__]}` in `config/prod.exs`). It carried the
full request context — headers, cookies, client IP — and behind the ALB's mTLS
that meant a ~2.5KB base64 client certificate on *every* line, about half of all
app log bytes. It is gone, and with it `cf-connecting-ip`, `cf-ipcountry`,
`x-vault-id` and `x-device-id`.

**Loki can no longer attribute a client. Use Tempo — it always had better data
for this anyway** (`client.address` and `user_agent.original` are span
attributes, not a serialized blob):

```traceql
{span.http.response.status_code=401}
  | count_over_time() by (span.client.address, span.user_agent.original)
```

Then narrow to one client to see what it is actually hammering:
```traceql
{span.client.address="<ip>"} | count_over_time() by (span.http.route)
```

That pair is what identified the 2026-08-01 burst as a single Obsidian install
pushing 281 `POST /api/folders` in six minutes. Loki still tells you *reason* and
*volume*; Tempo tells you *who*.

For historical incidents **before 2026-08-02** the old Loki recipe still works —
the blob is present in retained log lines up to that date.

`metadata_request_path` is `[REDACTED]` (RedactFilter), so routes come from Tempo
regardless of which era you are debugging.

Firing history for any rule, with the evaluated value:
```logql
{from="state-history"} | json | ruleUID="cfq15flt31a0wd" | current=~"Alerting.*"
```
(datasource `grafanacloud-alert-state-history`; note `ruleUID` is a parsed field, not a stream label, so it cannot go in the selector.)

## Don't misattribute to the dev machine
`category=client` remote-log lines and `category=auth` rejections are different populations and can point at different people. In this incident the `client` lines were ~96% from the maintainer's home NAT (their own Obsidian instances), while every `no_auth` rejection came from three foreign installs. Same alert dashboard, unrelated causes. Check the client address before concluding "it's us" — via `span.client.address` in Tempo (post-2026-08-02) or `cf-connecting-ip` in Loki (before that) — and remember a household NAT cannot distinguish the dev box from a laptop or phone on the same wifi.

Also expect two benign populations in any 401 breakdown, neither of which is a wedged client:
- **MCP OAuth discovery.** A 401 on the first unauthenticated `POST /api/mcp` is how the protocol works — the client reads `WWW-Authenticate` and follows it. Seen from `opencode`, `Cursor`, Claude Desktop. Steady, ~2 per 10m.
- **Crawlers.** GPTBot walks each API route exactly once (28 requests, one per route, all 401). One-per-route with no repeats is the tell — a wedged client repeats the *same* route hundreds of times.

## Related
- [[auth-failure-burst-stale-token-on-backend-switch]] in the workspace repo — the socket `signature_error` class, and the earlier retune that excluded `user_socket.ex`. That exclusion is why this HTTP-side class was left fully exposed.
- `spa-stale-socket-token-loop.md` — the backend mislabels expired Clerk tokens as `signature_error`, which muddies that reason but not `no_auth`.

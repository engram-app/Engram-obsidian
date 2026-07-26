# Context Doc: `Bearer ` with no token → `reason=no_auth` 401 loops

_Last verified: 2026-07-26_

## Status
**Fixed** — plugin PR #336 (`fix/no-empty-bearer-requests`). Alert rule deliberately unchanged.

## Symptom
`engram-prod-loki-auth-failure-burst` (Grafana uid `cfq15flt31a0wd`, threshold `>20` warn/error `category=auth` lines per 10m) fires several times a day, values clustered just over threshold (21–102). Reads like credential stuffing. Isn't.

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
```logql
sum by (ip, country) (count_over_time(
  {service="engram", env="prod"} | json
  | metadata_category="auth" | metadata_reason="no_auth"
  | json ip="metadata.__sentry__.request.headers[\"cf-connecting-ip\"]",
         country="metadata.__sentry__.request.headers[\"cf-ipcountry\"]" [24h]))
```

`metadata_request_path` is `[REDACTED]` (RedactFilter), so get routes from Tempo instead:
```traceql
{resource.deployment.environment="prod" && span.http.response.status_code=401}
  | count_over_time() by (span.http.route, span.client.address)
```

Firing history for any rule, with the evaluated value:
```logql
{from="state-history"} | json | ruleUID="cfq15flt31a0wd" | current=~"Alerting.*"
```
(datasource `grafanacloud-alert-state-history`; note `ruleUID` is a parsed field, not a stream label, so it cannot go in the selector.)

## Don't misattribute to the dev machine
`category=client` remote-log lines and `category=auth` rejections are different populations and can point at different people. In this incident the `client` lines were ~96% from the maintainer's home NAT (their own Obsidian instances), while every `no_auth` rejection came from three foreign installs. Same alert dashboard, unrelated causes. Check `cf-connecting-ip` before concluding "it's us" — and remember a household NAT cannot distinguish the dev box from a laptop or phone on the same wifi.

## Related
- [[auth-failure-burst-stale-token-on-backend-switch]] in the workspace repo — the socket `signature_error` class, and the earlier retune that excluded `user_socket.ex`. That exclusion is why this HTTP-side class was left fully exposed.
- `spa-stale-socket-token-loop.md` — the backend mislabels expired Clerk tokens as `signature_error`, which muddies that reason but not `no_auth`.

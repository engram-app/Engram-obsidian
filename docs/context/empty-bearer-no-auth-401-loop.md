# `Bearer ` with no token: `reason=no_auth` 401 loops

_Last verified: 2026-10-03_

Fixed in plugin PR #336, shipped in v1.19.0 (2026-08-01). A client still storming is one that has not updated. One unlinked install looped 285 401s in six minutes before the release and 3 in the 21 hours after.

## Alert coverage

`auth-failure-burst` (engram-infra `main/envs/prod/grafana_alerts.tf`) excludes `metadata_reason="no_auth"` because most of those are protocol-normal MCP OAuth discovery. The storm case is the separate `auth-no-auth-storm` rule in the same file (`> 50` no_auth per 10m, notify), so excluding no_auth from the security rule did not leave this failure mode unwatched.

## The reusable mechanism

An empty bearer token and a garbage bearer token log DIFFERENT reasons:

| Authorization header | logged `metadata_reason` |
|---|---|
| `Bearer ` (empty token) | `no_auth` |
| `Bearer abc` (garbage) | `signature_error` |
| absent | `no_auth` |

HTTP strips trailing whitespace from field values (RFC 9110 5.5), so `Bearer ` arrives as bare `Bearer`, misses the `["Bearer " <> token]` clause in `EngramWeb.Plugs.Auth.authenticate/1` and falls to `{:error, :no_auth}`. So **`no_auth` from a client that clearly sent an Authorization header means an empty credential, not a missing header.** Sentry's `PlugContext` scrubs `authorization` from logged headers, so absence of the key proves nothing. Confirm in one shot:

```bash
curl -s -o /dev/null -H "Authorization: Bearer " -H "User-Agent: engram-diag-emptytoken-probe" https://api.engram.page/api/me
```

then read the reason back out of Loki.

## Root cause (plugin)

`getAuthToken()` in `src/api.ts` returned `this.apiKey` when `authProvider` was null, which is `""` for an OAuth install. `authProvider` is nulled by `clearAuthAndPromptRelink()` (refresh token rejected, or manual Disconnect) and by `applyApiUrlChange()` in `auth-state.ts` (backend switch). Nothing gated sync, remote logging or the beacon on auth state, so the install kept firing requests that each got an instant 401 plus a warn line.

It is self-amplifying: two of the looping endpoints are `/api/logs` and `/api/telemetry/spans`, the client's own error reporting, so its report that it cannot authenticate is itself rejected and logged as a `category=auth` line.

**Fix:** `getAuthToken()` throws on an empty credential (one guard on the shared request path covers every caller), and the beacon transport drops its batch while `lastToken` is empty (the beacon posts with `window.fetch` and bypasses that path).

## Triage

Split the burst by reason and file (`no_auth` = empty credential, `signature_error` = wrong key):

```logql
sum by (reason, file) (count_over_time(
  {service="engram", env="prod"} | json
  | metadata_category="auth" | severity=~"warning|error"
  | label_format reason=`{{.metadata_reason}}`, file=`{{.metadata_file}}` [24h]))
```

Attribute to a client with Tempo, not Loki: Engram#1196 stopped serializing the `__sentry__` blob (request headers, client IP) into log lines, so Loki can no longer name a client. `metadata_request_path` is also `[REDACTED]`, so routes come from Tempo too.

```traceql
{span.http.response.status_code=401}
  | count_over_time() by (span.client.address, span.user_agent.original)
```

then `{span.client.address="<ip>"} | count_over_time() by (span.http.route)` for what it hammers. Loki still gives reason and volume.

Expect two benign populations in any 401 breakdown: MCP OAuth discovery (the first unauthenticated `POST /api/mcp` is how the protocol works; ~2 per 10m) and crawlers (one request per route with no repeats; a wedged client repeats the same route hundreds of times). `category=client` log lines and `category=auth` rejections are different populations and can point at different people: check the client address before concluding "it's us", and remember a household NAT cannot distinguish a dev box from a phone on the same wifi.

## Related

- `../engram-workspace/docs/context/auth-failure-burst-stale-token-on-backend-switch.md`: the socket `signature_error` class and the earlier retune that excluded `user_socket.ex` (why this HTTP-side class was left exposed)

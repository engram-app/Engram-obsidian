## Plugin Debugging — CDP & Obsidian DevTools

For server ops, infrastructure, connection/auth testing, and database schema, see `../engram-workspace/docs/deployment.md`.
For cross-project debugging workflows (plugin → backend tracing), see `../engram-workspace/docs/debugging.md`.

This doc covers **plugin-specific** debugging: Obsidian's Chrome DevTools Protocol and the MCP devtools server.

_Last verified: 2026-10-03_

### Obsidian Remote Debugging (CDP)

Obsidian exposes Chrome DevTools Protocol when launched with `--remote-debugging-port`.
A project-scoped MCP server (`obsidian-devtools`) connects to it for runtime inspection.

**Port assignments:**

| App | Debug Port | MCP Server |
|-----|-----------|------------|
| Obsidian | 9222 | `obsidian-devtools` (project-scoped) |
| Headless Chrome | 9224 | `chrome-devtools` (global) |

**Key quirk:** When launching Obsidian from an SSH or headless shell, you must set `DISPLAY=:0` or CDP won't bind. The desktop launcher inherits this from the graphical session automatically. The `--remote-debugging-port` flag works as expected — Obsidian binds to the specified port. (2026-03, corrected)

**Launch config:** `~/.local/share/applications/obsidian.desktop` has `--remote-debugging-port=9222` in the Exec line. The flag must be present to enable CDP — without it, no debug server starts.

**CLI launch:** `DISPLAY=:0 /home/open-claw/Applications/Obsidian.AppImage --no-sandbox --remote-debugging-port=9222`

**Verify it's working:**
```bash
curl -s http://127.0.0.1:9222/json/version   # Should return Chrome/Electron version info
curl -s http://127.0.0.1:9222/json/list       # Lists inspectable pages
```

**MCP config location:** `~/.claude.json` → project section for engram-obsidian → `mcpServers.obsidian-devtools`

### Obsidian DevTools MCP

`obsidian-devtools` exposes the standard chrome-devtools tool set (snapshots, `evaluate_script`, clicks, console messages, performance traces, heap snapshots) against the running Obsidian renderer; list the tools from the MCP client rather than from here. Prefer `take_snapshot` (a11y tree) over screenshots. `evaluate_script` is the most useful: it reaches `app`, `app.vault`, `app.workspace` and the plugin instance.

- `() => app.plugins.plugins["engram-vault-sync"]?.settings` inspects plugin settings at runtime
- `() => app.vault.adapter.read("path/to/note.md")` reads a file through Obsidian's API
- `window.__engramDebug` (installed only when `diagnosticsEnabled` is on, see `src/debug-api.ts`) returns a snapshot of hashes and lengths for a broken note; `__engramLog` (dev builds only) is the devLog ring buffer
- Console messages filtered to `error`/`warn` catch plugin exceptions, failed requests and deprecation warnings

Typical loops: inspect sync state with `evaluate_script`, then `list_console_messages(types: ["error"])`; profile a sync with `performance_start_trace` / `performance_stop_trace`; check for leaks with a heap snapshot during a long session.

### Limitations

- **Cannot reload/restart the Obsidian plugin** — user must toggle it off/on in Settings → Community Plugins (but `evaluate_script` can call `app.plugins.disablePlugin()` / `app.plugins.enablePlugin()` to automate this)
- **Cannot retrieve API keys from the database**: only hashes are stored; the user must provide the raw key
- **`evaluate_script` return values must be JSON-serializable** — cannot return functions, circular refs, or DOM nodes directly
- **Obsidian must be running with CDP enabled** — if Obsidian is closed or launched without `--remote-debugging-port`, all tools fail

# Context Doc: Probing real Obsidian editor behaviour over CDP (throwaway instance)

_Last verified: 2026-10-08 (Obsidian 1.12.7)_

## Why
Unit tests and the sim tier model CodeMirror and Obsidian; they cannot tell you
what Obsidian itself does when two panes share a file, when a file changes on
disk under an open editor, or when our `ViewPlugin` gets constructed. This
recipe runs a disposable Obsidian on a virtual display, drives it over CDP, and
never touches the user's own Obsidian config or vaults. Built for the #544
single-writer design (spec: Engram vault
`50 Engineering/_Superpowers Specs/2026-10-08-live-binding-single-writer-design.md`).

## How

### 1. Throwaway instance
- Create a throwaway vault dir and a throwaway config dir.
- Register the vault in `<config>/obsidian.json`:
  ```json
  {"vaults":{"<id>":{"path":"<vault>","ts":1700000000000,"open":true}}}
  ```
- Start a display, then Obsidian:
  ```bash
  Xvfb :91 -screen 0 1600x1000x24 &
  DISPLAY=:91 ~/Applications/Obsidian.AppImage --appimage-extract-and-run --no-sandbox \
    --remote-debugging-port=9291 --remote-allow-origins=http://127.0.0.1 \
    --disable-gpu --user-data-dir=<config>
  ```

### 2. CDP from Python
Use `websocket-client`. Pass `suppress_origin=True` to
`websocket.create_connection`, or the connection is refused with 403
`Rejected an incoming WebSocket connection from the http://127.0.0.1:9291 origin`.

### 3. Community plugins
- Enable: `localStorage.setItem("enable-plugin-" + app.appId, "true")`.
- A plugin folder added after startup is invisible until
  `await app.plugins.loadManifests()`; then `app.plugins.loadPlugin(id)`.

### 4. Probe plugin (observe only)
A CommonJS `main.js` using `require("obsidian")` (`editorInfoField`),
`require("@codemirror/view")` (`ViewPlugin`) and `require("@codemirror/state")`
(`Transaction`). On construct, log doc length and
`ownerIsView = editorInfoField.editor.cm === view`; on every transaction log the
`userEvent` annotation and `changes.toJSON()`. Push everything into
`window.__probe` and read it back over CDP.

### 5. Running the REAL live binding
Bundle an entry that imports `src/crdt/live/live-binding.ts` plus a fake
`LiveBindingCoordinator` (an in-memory `Y.Doc` per note, a `ready` promise
delayed by a `window.__delay` knob) and install it as a plugin:
```bash
NODE_PATH=<repo>/node_modules ./node_modules/.bin/esbuild entry.ts --bundle \
  --format=cjs --platform=browser --external:obsidian \
  --external:@codemirror/state --external:@codemirror/view
```
`NODE_PATH` is required when the entry file lives outside the repo.

### 6. Typing
Focus first (`leaf.view.editor.focus()`, then `setCursor`), then send CDP
`Input.insertText`.

### 7. Cleanup
Electron ignores SIGTERM:
```bash
pkill -9 -f "user-data-dir=<config>"
```
then kill the Xvfb.

## Findings (Obsidian 1.12.7)

1. **Two panes on one file.** Obsidian mirrors every change (user or
   programmatic) to the other pane asynchronously (under 300ms) as a
   `userEvent: "set"` transaction: a minimal diff to the source pane's full
   text. It is last-writer-wins: a concurrent edit in the other pane is
   overwritten. No-op when the panes already agree. With the real binding in
   both live panes: no doubling. Two pending panes typing during hydration: no
   doubling and no loss.
2. **External modify of an open file.** The editor reloads via a `"set"`
   transaction. With unsaved typing, Obsidian merges the external change with
   the typing and writes the merge to disk.
3. **ViewPlugin construction.** The plugin is constructed with the file content
   already loaded and `owner.editor.cm === view` in every case tried: new tab,
   same-leaf file switch (editor rebuilt), startup restore, deferred tab
   reveal, plugin loaded late.
4. **Live Preview CM doc includes frontmatter.** The CM document length equals
   the full file, `---` block included. This contradicts the header comment at
   `src/crdt/live/live-binding.ts:21-23` ("in Live Preview the CM document is
   body-only too"). The same stale claim is in `live-binding-decisions.ts`
   ~49-50, `src/crdt/wiring.ts` ~324-327 and `src/crdt/provider-registry.ts`
   ~250-255 (the stated reason `fmChanged` does not consult the editor).

## Gotchas
- Forgetting `suppress_origin=True` looks like a CDP auth problem; it is only
  the Origin header.
- `loadPlugin` on a folder added after boot fails silently without
  `loadManifests()` first.
- `"set"` transactions from finding 1 and 2 are Obsidian's, not ours; filter on
  `userEvent` before attributing a change to the binding.

# Context Doc: Live-binding attached to the table-cell editor — whole document adopted into one cell

_Last verified: 2026-08-31_

## Status
Fixed (PR #487)

## Symptom
Click into a table cell in Live Preview. The entire note body is inserted into
that cell, Obsidian freezes, and the corruption is written to disk and synced to
the server. Reliably reproducible; hit in production on
`30 Growth/Launch/Video 1 - Beta Invite Intro (script).md`, where six table rows
each grew to ~17,900 characters holding the whole body with newlines serialized
as `<br>`.

## Mechanism
`this.registerEditorExtension([liveBindingPlugin])` (`src/main.ts`) installs the
binding into **every** CM6 `EditorView` Obsidian builds — not just the leaf's
markdown editor.

Obsidian's Live Preview table widget builds a nested `EditorView` per cell
(`editor.tableCell.cm` in `app.js`) and constructs it with the **parent editor's
`owner`**. `editorInfoField` inside a cell therefore resolves to the very same
`MarkdownView`, carrying the very same `file.path`.

The old `editorPath()` keyed only off that path, so the cell's `EditorView` bound
to the whole note's `Y.Text`:

1. `attach()` -> `resolveId(path)` -> `residentText(noteId)` = the full note body.
2. `preEditText` = the **cell's** text; `dirtySinceAttach` = false.
3. `decideReconcile(cellText, fullBody, false)` -> `adopt` — "the editor is stale
   disk, the doc is authoritative".
4. `paintEditor()` dispatches that diff into the cell, replacing a few words with
   the entire document.
5. Obsidian's table code round-trips the cell back into the real document, which
   the sync engine then pushes.

The freeze is downstream: a multi-KB cell forces a table rebuild, which the 3s
drift check keeps re-triggering.

## Fix
`ownedMarkdownPath(view, info)` in `src/crdt/live/live-binding-decisions.ts`.
Bind only when the `EditorView` **is** the owner's own editor:

```ts
if (!info || info.editor?.cm !== view) return null;
```

This is the guard Relay has always had (`LiveViews.ts findView`: `cm === cmEditor`),
which is why Relay never had this bug. It covers every nested editor Obsidian
builds off a parent owner, not just table cells.

## Gotcha: construction-time null
The `ViewPlugin` constructor runs **inside** `new EditorView(...)`, before
Obsidian assigns `owner.editor.cm`. So `ownedMarkdownPath` returns null on the
first `attach()` even for the real editor. That is fine and deliberate:
`update()` re-resolves on every `ViewUpdate` and `needsReattach` fires on the
null -> path transition, so the binding attaches on the first update (Obsidian's
own file-load dispatch guarantees one). Do not "fix" this by weakening the check
to a path comparison.

## How to verify a change here
`tests/crdt-live-binding-decisions.test.ts` -> `describe("ownedMarkdownPath")`
covers the own-editor, inherited-cell-info, missing-file, non-markdown, and
unassigned-`cm` cases. No CodeMirror mount needed.

## Related
- `crdt-editor-bind-race-pollution.md` — the other cross-file pollution class
  (reused EditorView across a file switch). Different trigger, same blast radius.

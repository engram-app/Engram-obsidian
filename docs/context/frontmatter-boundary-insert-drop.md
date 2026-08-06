# Context Doc: first-line typing mangled/lost — boundary insert dropped by the FM guard

_Last verified: 2026-08-05_

## Status
Fixed (branch `fix/first-line-boundary-insert-drop`)

## Symptom
Typing at the very beginning of a note mangles and loses characters — only at the start of the first line. Example: doc `Hello`, type `AB` at the start → ends up `HBello` after ~3s.

## Mechanism
`live-binding.ts` forwards local CM edits to the body-only Y.Text, dropping changes inside the frontmatter block (`[0, prefix)`) because the FM hook owns them. The guard was `if (toA <= prefix) return;`. A **pure insert at the boundary** (`fromA === toA === prefix`) — typing at the start of the first body line — satisfies it and is silently dropped. With **no frontmatter at all**, `prefix` is 0 and an insert at position 0 has `toA = 0 <= 0`: same drop.

Cascade: the dropped insert never reaches the Y.Text → every following keystroke forwards with offsets shifted by the dropped length → characters interleave wrongly in the doc → the 3s drift check declares the doc authoritative and snaps the editor to the mangled text.

## Fix
`classifyEditSpan(fromA, toA, prefix)` in `live-binding-decisions.ts` (pure, unit-tested): `body` when `fromA >= prefix`, `frontmatter` when `toA <= prefix`, `spans` otherwise — **checked in that order**, so the boundary insert classifies as body. Frontmatter is the half-open range `[0, prefix)`; position `prefix` is body offset 0.

## Review findings (same bug class, fixed in the same branch)
- **FM creation in one transaction** (paste a complete `---` block at position 0, select-all paste of a full note, typed fence completion): per-change classification against the PRE-change prefix of 0 is meaningless — the same chars flip from body to FM mid-transaction, and the boundary fix would have forwarded the block into the body-only Y.Text (duplicated after drift re-adopt). `fmCreationBodyDiff` forwards a body(before)→body(after) diff instead (empty for a pure FM paste).
- **`CrdtFrontmatterHook` diffed `view.text` (FULL file text) into the body-only CONTENT Y.Text** — every patchable `saveFrontmatter` (properties edit) would prepend the whole FM block to the body and broadcast it. Its old tests encoded the wrong full-doc contract. Now diffs `splitFrontmatter(newText).body`; usually a no-op — FM itself syncs via the disk-save path (`routeModify` → `seedContentInto`). Follow-up candidate: the hook may now be pure dead weight (deletable) since it never wrote the FM Y.Maps.

## General Lesson
Any "is this edit inside region X" guard on half-open ranges must decide which side owns the boundary for **zero-width (insert) edits** — `<=`/`>=` comparisons silently claim the boundary for the wrong side. Deletions at the same spot span past the boundary and mask the bug, so it only bites pure inserts (i.e. typing).

## References
- `src/crdt/live/live-binding.ts` — `update()` forward path
- `src/crdt/live/live-binding-decisions.ts` — `classifyEditSpan`
- `tests/crdt-live-binding-decisions.test.ts` — boundary cases
- Sibling doc: `crdt-editor-bind-race-pollution.md` (different first-line-adjacent class: bind race, not offsets)

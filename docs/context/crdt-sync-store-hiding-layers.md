# Context Doc: SyncStore hiding layers must expire

_Last verified: 2026-08-16 (PR #431, review round 5)_

## Status
Fixed. Three separate instances of one bug shape, found across rounds 3, 4 and 5
of the same PR.

## What This Is
`src/crdt/sync-store.ts` keeps several Sets that HIDE an entry from reads
without removing it from the shared Y.Map: `evicted`, `forgotten`,
`renamedAway`, `deleteSet`. They exist because the doc is the authority and a
device often needs to stop answering for a path *before* the authoritative
removal arrives. Each one is a **bridge covering a window**, never a verdict.

If nothing clears the Set, the bridge never comes down and the layer becomes
permanent blindness for the session.

## The failure chain
It always runs the same way, and the end of it is data loss:

1. A path is hidden locally.
2. A peer legitimately re-claims that path (or a local rename moves a real note
   into it).
3. `getMeta` / `pathForId` still answer `null`, because the hiding Set outranks
   the doc.
4. `getOrMint` concludes the path is unclaimed and **mints a second id for a
   note that already has one**.
5. It publishes that id, overwriting the live claim. Inbound CRDT frames for the
   original id now have no path to resolve to.

That is the duplicate-id / wrong-mint class documented in
`crdt-wrong-mint-cross-file-overwrite.md`, reached from a different direction.

## Why it shipped three times
- **Round 3** added `evicted` with no clear at all.
- **Round 4** fixed `evicted` in `commit()` and wrote the reason down in a
  comment: *"keeping it is pure blindness: a peer that re-claims that id at
  another path would never be visible to `pathForId` again."*
- **Round 5** found `forgotten` — added to fix an e2e failure — had
  reintroduced the identical shape one indirection over, *after* that comment
  existed.

Coverage was ~99% on this file the whole time. The tests asserted the **staged
window** and stopped before the layer was required to expire, so the bug lived
entirely in untested lines that the coverage number counted as covered.

## The rule
When adding or reviewing a hiding Set, the comment must answer two questions:

1. **What event clears this?**
2. **What happens if that event never fires?**

For remote-driven layers the answer to (1) is almost always the `map.observe`
handler's `event.keysChanged` — a peer rewriting the key is exactly the signal
that the bridge is no longer needed:

```ts
this.map.observe((event) => {
  for (const key of event.keysChanged) {
    if (typeof key === "string") this.forgotten.delete(key);
  }
  this.reverse = null;
});
```

(`keysChanged` is `Set<any>` in yjs's types, so narrow rather than assert — CI's
`lint:obsidian` fails `@typescript-eslint/no-unsafe-argument` otherwise.)

**The observer does not cover everything.** A rename whose SOURCE this device
has never seen records only a redirect and writes no key, so the commit changes
nothing and — per yrs' transaction commit hook — **fires no observer at all**.
`rename()` therefore clears the target itself. This is the case where a naive
mutation test lies: removing the `rename` clear left every test green because
the observer covered the known-source path.

## Testing it
A test that ends before `commit()` cannot see this bug. The shape that works:

1. Hide the path.
2. Let a peer re-claim it (two `Y.Doc`s + `Y.applyUpdate`, not one doc).
3. `commit()`.
4. Assert `get`, `pathForId`, **and** `getOrMint` — `getOrMint` is where the
   consequence actually lands.

Then mutation-prove it: revert the one-line clear and confirm exactly one test
goes red. `tests/index-crdt-regressions.test.ts` ("a forget is a bridge, not a
verdict") is the worked example.

## Related
- `crdt-wrong-mint-cross-file-overwrite.md` — the consequence class
- `crdt-editor-bind-race-pollution.md` — same `pathForId` seam, different cause
- Local-vs-published split: `forget()` is local-only and takes the LITERAL path;
  `delete()`/`release()` publish and resolve through the rename chain. A forget
  that resolved reached through a staged rename and published a bare deletion —
  the exact failure it was written to prevent.

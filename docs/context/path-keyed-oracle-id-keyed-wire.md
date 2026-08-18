# Context Doc: a path-keyed oracle must not gate an id-keyed wire

_Last verified: 2026-08-18 (release-v0.17.0 e2e-clerk, 2/2 attempts)_

## Status
Fixed. Found by e2e `test_27_empty_note_sync` blocking the prod deploy gate,
not by a user report — but the same shape was already reaching users.

## The one-line rule

**`hasServerNote(id)` answers a question about a PATH.** If you use it to decide
whether the SERVER knows an ID, you will send frames the backend drops.

```ts
hasServerNote(noteId) {
  const path = this.noteIdMap?.pathForId(noteId);  // id -> path
  if (!path) return false;
  return this.getCrdtHead(path) != null;           // ...but this is a PATH fact
}
```

`getCrdtHead` reads `syncState.get(path)?.crdtHead`, and `setCrdtHead`'s own
comment says it: *"crdtHead persists under the vault path."* The CRDT wire is
keyed by `note_id`. Those are different keys, and nothing reconciles them.

## How it fails

A path keeps its head across an id change. So an id minted *seconds ago* for a
path whose server row already exists inherits that path's "the server knows
this" verdict:

```
route: n90 ... server=false id=01a0145d-cd61-…   create — server row keyed cd61
modify path=E2E/EmptyNote.md bytes=44
route: n90 ... server=true  id=01a0145d-d1a9-…   id-map entry lost -> fresh mint
CRDT push ok: n90
crdt_msg dropped by server (note_not_found): 01a0145d-d1a9-…
```

`server=true` for `d1a9` is the lie. The backend never issued `d1a9`, so it
drops the frame and the 44 bytes are gone.

**Reading uuid7 as a clock is what proved it.** The first 48 bits are the mint
timestamp in ms: `0x01a0145dd1a9 - 0x01a0145dcd61 = 17480` — `d1a9` was minted
17.5 s after `cd61`. That is a *second id for a note that already had one*, not
a redelivery. Do this before theorising; it is free and it is decisive.

## Why the retry never saved it

`recordCrdtBaseline` banks the transmitted content as the echo baseline the
instant `routeModify` consumes it into the local Y.Doc — **before any server
ack**, because normally the live channel carries it from there. A dropped frame
walks nothing back, so the hoisted echo gate in `pushFile` hash-matches those
exact bytes and skips every retry:

```
Echo skip: n90 | hash=1821472990
Echo skip: n90 | hash=1821472990   ...forever
```

A recoverable drop becomes permanent content loss. **Success recorded before
delivery is confirmed is not bookkeeping, it is a lie the guard then enforces.**

## The trigger

The mint only happens because the id-map answered `null` for a claimed path —
the hiding-layer class in [[crdt-sync-store-hiding-layers]]. That doc covers
why the entry goes missing. This one covers what the engine does next, which
was wrong independently: even with a correct map, any future id divergence
would have produced the same dropped frame.

## The fix

Two guards, both mutation-proven:

1. `mintedNow` — an id minted by *this* push cannot be one the server issued,
   whatever the path-keyed oracle says. It falls through to the genesis
   `crdt_create` branch, whose **ADOPT** case already returns the authoritative
   id for a path the server owns and re-keys the map. The recovery existed; the
   stale path-keyed head was gating it out.
2. `clearPushedBaselineForId` — `onCrdtNoteNotFound` un-banks the echo baseline
   before healing the map, so the retry actually re-sends.

## Testing traps hit while writing this

- **A stub that echoes its input passes by construction.** The first
  `setCrdtCreate` double was `async (id) => id`, which can never model ADOPT —
  the test went green against the bug. Model the server (`Map<path, id>`),
  don't stub it. Same lesson as `modelVaultFs` in #441.
- **An assertion that loops over `mock.calls` is vacuous when the array is
  empty.** The first version passed because the push never ran at all. Pair any
  `for (const call of …)` with an explicit `.length` assertion.
- **`shouldDeferMint` only covers engine-flushed files.** A locally authored
  note (the field case, and test_27) is not flushed, so that guard does not
  apply — a repro built on `applySyncChange` is caught by it and proves nothing.

## Don't do this again

Before using any oracle to gate a transport, check that **the oracle's key and
the wire's key are the same key**. Prior art in this repo, same shape:
`do_bare_insert` writes global / reads vault-scoped; content-keyed workers
reading the facade instead of `authoritative_content`.

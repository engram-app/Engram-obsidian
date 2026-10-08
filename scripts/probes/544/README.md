# #544 probe harnesses (2026-10-08)

Throwaway investigation tooling, kept so nobody has to rebuild it. Paths inside are
absolute to the machine they were written on; adjust before running. Full write-up:
`docs/context/live-binding-544-investigation.md`.

## `relay/`: run Relay's real merge code against the #544 sequences

Relay's own test harness (`__tests__/`) is git-crypt encrypted, so these bundle Relay's
REAL `src/merge-hsm/MergeHSM.ts`, `snapshots.ts` and `integration/replayBufferedEdits.ts`
with esbuild and drive them with a mock persistence:
LOAD -> PERSISTENCE_LOADED -> SET_MODE_ACTIVE -> OBSIDIAN_SET_VIEW_DATA -> ACQUIRE_LOCK.
The editor-plugin buffering (HSMEditorPlugin) needs a live CM6 view, so it is emulated
line by line in `harness.ts`. `build.sh` bundles; run the resulting `s0.js`/`s1.js`/`s5.js`
with node. Requires `npm ci` in the Relay clone (`~/documents/code-projects/relay/Relay`).

- `s1.ts`: type T, autosave, type U, go-live (+ remote edit variant). Relay DOUBLES T.
- `s0.ts`: typing without autosave (correct).
- `s5.ts`: sibling panes, echo provenance (correct).

## `obsidian/`: run OUR real binding inside real Obsidian

Method: `docs/context/obsidian-cdp-binding-probe.md`. `realbind-entry.ts` bundles the
prototype `live-binding.ts` with a fake coordinator (in-memory Y.Doc per note seeded
from the file, LCA, disk-write log from `vault.on("modify")`, remote-edit injector, and
`window.__legacyDiskWriter` which reproduces TODAY's sync engine writing disk into an
open note's doc). `realbind-entry-legacy.ts` is the same for an older binding (adds the
old `readDisk`). `scen.py` (S1-S6) and `scen2.py` (S2, S7) drive it over CDP with real
typing (`Input.insertText`) and real Obsidian autosave.

Key result: `origin/main` binding + legacy disk writer FAILS S2 (remote edit reverted);
prototype binding with the disk writer off PASSES S1-S6.

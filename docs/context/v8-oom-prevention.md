# V8 OOM prevention

_Last verified: 2026-10-03_

In v0.3.5 Obsidian crashed with V8 out-of-memory errors when other plugins were enabled alongside Engram: their startup file modifications flooded the sync engine with push requests before it was ready. Heap stayed stable (~37MB) after these mitigations, all still in place:

1. **Ready gate.** `handleModify`, `handleDelete` and `handleRename` return immediately until `setReady()` (called in `main.ts` after the initial sync in a `finally`, inside `onLayoutReady`).
2. **Content-free offline queue.** Entries store path/action/kind/mtime only; content is re-read from the vault on flush (prevents O(n^2) serialization). Legacy entries with inline content are still honored on load.
3. **Debounced persistence.** `OfflineQueue.schedulePersist()` coalesces writes (default 1s).
4. **Push concurrency limiter.** A semaphore caps concurrent pushes at 5 (`maxConcurrentPushes`, `acquirePushSlot`/`releasePushSlot` in `src/sync.ts`).

The mitigations resolved the symptom; the root cause in Electron's memory management was never fully traced.

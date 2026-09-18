# Third-party notices

This plugin is MIT-licensed (see `LICENSE`). Portions of it are derived from
third-party MIT-licensed work, whose copyright notices are reproduced below as
that license requires.

## No-Instructions/Relay

Parts of the CRDT sync core and the CodeMirror 6 live-binding layer are derived
from Relay by No Instructions, LLC.

Files containing derived work:

| File | Derived from |
|---|---|
| `src/crdt/note-provider.ts` | `src/client/provider.ts` |
| `src/crdt/live/live-binding.ts` | `src/y-codemirror.next/LiveNodePlugin.ts` |
| `src/crdt/live/cm-yjs-bridge.ts` | `src/y-codemirror.next/LiveNodePlugin.ts` |
| `src/crdt/live/reading-view.ts` | `src/plugins/PreviewRenderer.ts` |
| `src/crdt/live/obsidian-internals.ts` | `src/plugins/ViewHookPlugin.ts`, `src/plugins/PreviewRenderer.ts` |
| `src/crdt/destroyed-error.ts` | `src/DestroyedError.ts`, `src/DocumentDestroyedError.ts` |
| `src/crdt/invariants.ts` | `src/merge-hsm/invariants/` |
| `src/lifetime.ts` | `src/promiseUtils.ts` |
| `src/time-provider.ts` | `src/TimeProvider.ts` |
| `src/track-promise.ts` | `src/trackPromise.ts` |
| `src/has-logging.ts` | `src/debug.ts` |
| `src/debug-snapshot.ts` | `src/RelayDebugAPI.ts` |
| `src/offline-queue.ts` | `queuedReasonForSnapshot` |

```
MIT License

Copyright (c) 2024 No Instructions, LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## y-codemirror.next

`src/crdt/live/cm-yjs-bridge.ts` additionally derives its CM6 <-> Y.Text offset
transforms from y-codemirror.next.

```
MIT License

Copyright (c) 2021 Kevin Jahns <kevin.jahns@protonmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

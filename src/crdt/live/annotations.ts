// src/crdt/live/annotations.ts
// Adapted from Relay src/merge-hsm/integration/annotations.ts (No-Instructions/Relay).
import { Annotation } from "@codemirror/state";

/** Marks a CM6 transaction that originated from Yjs sync (CRDT to editor), so
 *  the editor binding's update() does NOT re-capture it (it already came from
 *  the CRDT). Set with ySyncAnnotation.of(view) when dispatching; read with
 *  tr.annotation(ySyncAnnotation) when receiving. */
export const ySyncAnnotation = Annotation.define<unknown>();

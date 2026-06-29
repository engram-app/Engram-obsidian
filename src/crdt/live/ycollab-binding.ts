// yCollab-based editor<->Y.Text binding, swappable per note via a CM6 Compartment.
// yCollab is y-codemirror.next's battle-tested binding (the engram web app uses
// it against this same backend). It also provides a Yjs UndoManager so Ctrl+Z
// undoes only local edits, not remote peers' edits.
import { Compartment, type Extension } from "@codemirror/state";
import { yCollab } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { type CmChangeSpec, textDiffToChangeSpec } from "./cm-yjs-bridge";

/** The single Compartment that holds the active note's yCollab binding. The
 *  plugin registers ycollabExtension() once; CrdtLiveViews reconfigures this
 *  Compartment to bindSpec(newYtext, awareness) on note switch. */
export const crdtCompartment = new Compartment();

/** Registered once via registerEditorExtension. Empty until a note binds. */
export function ycollabExtension(): Extension {
	return crdtCompartment.of([]);
}

/** The yCollab binding for a specific note's Y.Text. Awareness is local-only. */
export function bindSpec(ytext: Y.Text, awareness: Awareness): Extension {
	return yCollab(ytext, awareness);
}

/** Minimal CM changes to make an editor whose current text is `currentDoc`
 *  equal the Y.Text content. yCollab only forwards FUTURE deltas, so on bind
 *  the editor must be reconciled to the existing Y.Text content first. Returns
 *  [] when already equal. */
export function reconcileEditorToYText(currentDoc: string, ytext: Y.Text): CmChangeSpec[] {
	return textDiffToChangeSpec(currentDoc, ytext.toString());
}

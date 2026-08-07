// src/crdt/live/obsidian-internals.ts
// Isolated, feature-detected access to Obsidian internals. Every function here
// returns null/false when the internal shape is absent so callers fall back to
// the existing disk path (degraded to bursty, never broken). Patterns adapted
// from Relay src/plugins/ViewHookPlugin.ts + PreviewRenderer.ts.
import type { EditorView } from "@codemirror/view";

export function getEditorViewForLeaf(view: unknown): EditorView | null {
	const cm = (view as { editor?: { cm?: unknown } })?.editor?.cm;
	return cm && typeof (cm as EditorView).dispatch === "function" ? (cm as EditorView) : null;
}

export function getMarkdownFilePath(view: unknown): string | null {
	const path = (view as { file?: { path?: string } })?.file?.path;
	return typeof path === "string" ? path : null;
}

export function setPreviewRendered(view: unknown, text: string): boolean {
	const pm = (view as { previewMode?: { renderer?: { set?: (t: string) => void } } })
		?.previewMode;
	if (!pm?.renderer || typeof pm.renderer.set !== "function") return false;
	try {
		pm.renderer.set(text);
		// Only trigger onInternalDataChange when the CM6 editor is absent (preview-only
		// mode). In live-preview mode editor.cm is present and Obsidian's own pipeline
		// handles the refresh; calling onInternalDataChange there causes a double-update.
		// Matches Relay PreviewRenderer.ts logic (guarded by !view.editor?.cm).
		const hasCm = !!(view as { editor?: { cm?: unknown } })?.editor?.cm;
		if (!hasCm) {
			(view as { onInternalDataChange?: () => void }).onInternalDataChange?.();
		}
		return true;
	} catch {
		return false;
	}
}

/** Obsidian's READING view applies in-preview edits — a checkbox toggle, an edited
 *  embedded task — by calling `previewMode.edit(fullText)`, which writes the file
 *  directly. For a note that is ALSO open in an editor pane the disk write is then
 *  skipped as binding-owned, so the toggle never reaches the Y.Text and the next
 *  paint reverts it. Relay's ViewHookPlugin Hook 3 patches the same method.
 *
 *  `consume` receives the view's full new text and returns true when it took the
 *  edit (Obsidian's own write is then skipped) or false to fall through — which is
 *  what a note with no live binding must do, since its ordinary disk-modify path
 *  already routes the change correctly. Returns null when the internals are not the
 *  expected shape, so an Obsidian change degrades to "no hook", never a crash. */
export function patchPreviewEdit(
	view: unknown,
	consume: (fullText: string) => boolean,
): (() => void) | null {
	const v = view as { getMode?: () => string; previewMode?: { edit?: (data: string) => void } };
	const preview = v.previewMode;
	const original = preview?.edit;
	if (!preview || typeof original !== "function" || typeof v.getMode !== "function") return null;
	preview.edit = (data: string) => {
		try {
			if (v.getMode?.() === "preview" && consume(data)) return;
		} catch {
			// swallow: a hook failure must not break Obsidian's own edit path.
		}
		original.call(preview, data);
	};
	return () => {
		preview.edit = original;
	};
}

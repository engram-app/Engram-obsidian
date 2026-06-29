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

export function patchFrontmatterSave(
	view: unknown,
	onSave: (newText: string) => void,
): (() => void) | null {
	// Relay ViewHookPlugin.ts patches view.saveFrontmatter, then reads view.text
	// for the post-save full document text (not view.data). view.text is the internal
	// field Obsidian keeps in sync with the file's content after a save.
	const v = view as { saveFrontmatter?: (...a: unknown[]) => unknown; text?: string };
	if (typeof v.saveFrontmatter !== "function") return null;
	const original = v.saveFrontmatter.bind(v);
	v.saveFrontmatter = (...args: unknown[]) => {
		const result = original(...args);
		try {
			if (typeof v.text === "string") onSave(v.text);
		} catch {
			// swallow: a hook failure must not break Obsidian's own save.
		}
		return result;
	};
	return () => {
		v.saveFrontmatter = original;
	};
}

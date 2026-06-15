/**
 * Text-attachment extension set for the Free-tier client-side pre-gate.
 *
 * Source of truth: the backend's Free text-only attachment gate, which is
 *   `text_only?(user) and not text_mime?(effective_mime)`
 * in `attachments_controller.ex` (`do_upload_gated`). There:
 *   - `text_mime?/1` returns true iff the MIME `String.starts_with?("text/")`.
 *   - `effective_mime` is the explicit `mime_type` the client sends, falling
 *     back to `MimeWhitelist.detect_mime(path)`.
 *
 * The plugin ALWAYS sends an explicit `mime_type` (see `getMimeType` /
 * MIME_TYPES in sync.ts), so the gate effectively asks: does the MIME the
 * plugin would send start with `text/`? Of the backend's `detect_mime` table,
 * only these extensions yield a `text/*` MIME — so these are the exact set that
 * a Free user IS allowed to upload as an attachment:
 *
 *   .txt  -> text/plain
 *   .md   -> text/markdown
 *   .css  -> text/css
 *   .html -> text/html
 *
 * (`.md`/`.canvas` normally sync as NOTES, not attachments, so in practice the
 * binary-attachment pre-gate skips every Free attachment; `.md`/`.txt` are kept
 * here for correctness so the rule mirrors the server exactly.)
 *
 * Keep in sync with the backend — a mismatch causes false skips (a file the
 * plugin refuses to upload that the server would have accepted) or false
 * attempts (an upload the plugin makes that the server rejects with 402).
 */
const TEXT_ATTACHMENT_EXTS = new Set(["txt", "md", "css", "html"]);

/** True iff an attachment with this extension passes the backend's Free-tier
 *  text-only gate (i.e. its effective MIME starts with `text/`). */
export function isTextAttachment(ext: string): boolean {
	return TEXT_ATTACHMENT_EXTS.has(ext.toLowerCase());
}

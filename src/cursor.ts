/** Encode an ordered-sync cursor token from (seq, id).
 *  Mirrors the backend codec: base64url of "<seq>:<id>", no padding.
 *  Used only for the final-page head cursor — mid-stream cursors are the
 *  server-issued opaque next_cursor, passed through untouched. */
export function encodeCursor(seq: number, id: string): string {
	return btoa(`${seq}:${id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

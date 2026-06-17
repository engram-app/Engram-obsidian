/** The maximum UUID — sorts after every real id. A bootstrap cursor of
 *  `(change_seq, MAX_CURSOR_UUID)` makes the next keyset pull return strictly
 *  `seq > change_seq` (everything ≤ change_seq was already delivered by the
 *  snapshot bootstrap). Mirrors spec §E. */
export const MAX_CURSOR_UUID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

/** Encode an ordered-sync cursor token from (seq, id).
 *  Mirrors the backend codec: base64url of "<seq>:<id>", no padding.
 *  Used only for the final-page head cursor — mid-stream cursors are the
 *  server-issued opaque next_cursor, passed through untouched. */
export function encodeCursor(seq: number, id: string): string {
	return btoa(`${seq}:${id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The one home for the y-protocols wire frame codec. Shared by the transport
// (CrdtChannel, being retired) and the Relay-model NoteProvider so the bytes on
// the wire are byte-identical and there is a single source of truth.
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";

/** Outer y-protocols message-type tag — we only speak messageSync (Relay's
 *  messageSync = 0). */
export const MESSAGE_SYNC = 0;

export function toB64(bytes: Uint8Array): string {
	// Avoid spread-into-String.fromCharCode which stack-overflows on large updates.
	return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}

export function fromB64(b64: string): Uint8Array {
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Wrap a raw Yjs v1 update as a base64 `messageSync` update frame — the EXACT
 *  encoding a live crdt_msg puts on the wire, so a batch genesis frame is
 *  byte-identical to a live one and both decode through the backend's
 *  SharedDoc.send_yjs_message the same way. */
export function encodeUpdateFrame(update: Uint8Array): string {
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, MESSAGE_SYNC);
	syncProtocol.writeUpdate(encoder, update);
	return toB64(encoding.toUint8Array(encoder));
}

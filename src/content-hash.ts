/** Fast string hash (FNV-1a 32-bit). Not cryptographic — just for content
 *  change detection.
 *
 *  Lives in its own module rather than in sync.ts so a consumer that needs only
 *  a content hash (the debug snapshot, and shortly the LCA record) does not pull
 *  the entire sync engine into its import graph. `sync.ts` re-exports it, so
 *  existing importers are unaffected. */
export function fnv1a(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** Lowercase hex of a byte array. The one byte-to-hex mapper — this loop was
 *  re-implemented in four modules before landing here. */
export function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of a UTF-8 string as lowercase hex (Web Crypto). */
export async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return bytesToHex(new Uint8Array(digest));
}

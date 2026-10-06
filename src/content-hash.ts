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

// Char codes of the standard base64 alphabet. A typed-array table measured
// 10-20% faster than String#charCodeAt in this loop (JSC and V8).
const B64 = Uint8Array.from(
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
	(c) => c.charCodeAt(0),
);
const PAD = 61; // "="

/** `fnv1a(base64(bytes))` without building the base64 string. The attachment
 *  sync hash has always been fnv1a over the padded standard base64 (what the
 *  push side hashes), so a raw download must produce the same number; building
 *  the string first costs ~65 ms/MB in `arrayBufferToBase64` (bun), this ~3 ms/MB. */
export function fnv1aBase64(buffer: ArrayBuffer): number {
	const b = new Uint8Array(buffer);
	const full = b.length - (b.length % 3);
	let h = 0x811c9dc5;
	let i = 0;
	for (; i < full; i += 3) {
		const v = (b[i]! << 16) | (b[i + 1]! << 8) | b[i + 2]!;
		h = Math.imul(h ^ B64[v >>> 18]!, 0x01000193);
		h = Math.imul(h ^ B64[(v >>> 12) & 63]!, 0x01000193);
		h = Math.imul(h ^ B64[(v >>> 6) & 63]!, 0x01000193);
		h = Math.imul(h ^ B64[v & 63]!, 0x01000193);
	}
	const rest = b.length - full;
	if (rest > 0) {
		const v = (b[i]! << 16) | (rest === 2 ? b[i + 1]! << 8 : 0);
		h = Math.imul(h ^ B64[v >>> 18]!, 0x01000193);
		h = Math.imul(h ^ B64[(v >>> 12) & 63]!, 0x01000193);
		h = Math.imul(h ^ (rest === 2 ? B64[(v >>> 6) & 63]! : PAD), 0x01000193);
		h = Math.imul(h ^ PAD, 0x01000193);
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

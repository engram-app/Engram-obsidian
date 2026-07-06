/** Minimal UUIDv7 (RFC 9562 §5.7) minter.
 *
 * `crypto.randomUUID()` (used elsewhere in this codebase for connection/idempotency
 * ids) only produces v4 — random, no time ordering. Task 5 of the note_id-keyed
 * CRDT rework needs a client-mintable id for brand-new notes that's roughly
 * creation-ordered (v7 embeds a 48-bit ms timestamp in the top bits), so a v4
 * won't do. No `uuid` package is in package.json (checked before adding this),
 * so this is a small self-contained generator instead of a new dependency.
 *
 * ponytail: "roughly" ordered — ties within the same millisecond fall back to
 * pure randomness (no monotonic counter), which is fine for a client_id nonce.
 * Swap for a battle-tested lib if strict per-ms monotonic ordering ever matters.
 */
export function uuid7(): string {
	const tsHex = Date.now().toString(16).padStart(12, "0").slice(-12);
	const rand = new Uint8Array(10);
	crypto.getRandomValues(rand);
	rand[0] = ((rand[0] ?? 0) & 0x0f) | 0x70; // version 7 nibble
	rand[2] = ((rand[2] ?? 0) & 0x3f) | 0x80; // variant 10xx
	const hex = (arr: Uint8Array) =>
		Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
	return [
		tsHex.slice(0, 8),
		tsHex.slice(8, 12),
		hex(rand.subarray(0, 2)),
		hex(rand.subarray(2, 4)),
		hex(rand.subarray(4, 10)),
	].join("-");
}

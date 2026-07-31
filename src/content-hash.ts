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

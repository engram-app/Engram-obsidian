// The disk<->Y.Doc seed/diff codec, extracted from CrdtManager so the Relay-
// model ProviderRegistry reuses the EXACT same logic (byte-identical CRDT ops
// for the same content — a divergent encoding corrupts a note when two lineages
// merge). This is NOT bespoke cruft: it's the hard-won correctness for syncing
// Obsidian's INDEPENDENT disk files across devices, which Relay itself never
// needs (Relay docs are the source of truth; ours mirror files on disk). Pure,
// no Obsidian imports.
import type * as Y from "yjs";
import { diffIntoYText, seedOnce } from "./bridge";
import { canvasIsEmpty } from "./canvas-codec";
import {
	CONTENT_KEY,
	FRONTMATTER_KEY,
	ORDER_KEY,
	parseFrontmatter,
	RAW_FRONTMATTER_KEY,
	splitFrontmatter,
} from "./frontmatter-codec";

/** True when a body Y.Text already carries CRDT history (non-empty after IDB
 *  rehydration). A history-less doc must adopt server state, never seed disk
 *  drift (that mints a second lineage → the #846 doubling). */
export function textHasHistory(text: Y.Text): boolean {
	return text.length > 0;
}

/** True when either shape already holds content (markdown body OR canvas maps). */
export function docHasHistory(doc: Y.Doc, kind: "note" | "canvas"): boolean {
	return kind === "canvas" ? !canvasIsEmpty(doc) : textHasHistory(doc.getText(CONTENT_KEY));
}

/** Whole-document history check for a RAW `Y.applyUpdate` site (#1409's
 *  genesis local-apply). Unlike `docHasHistory` (body-only — the seed-
 *  strategy `lca` decision `applyLocalEdit`/`seedContentInto` make, which
 *  stays safe regardless of frontmatter state because frontmatter has its
 *  own separate upsert-by-key merge via `applyFrontmatterInto`), a raw
 *  `Y.applyUpdate` has no such per-key merge — it is a concurrent INSERT
 *  into WHATEVER shared types the frame touches, body Y.Text and the
 *  frontmatter ORDER_KEY Y.Array alike. A frontmatter-only note (empty
 *  body) with existing history was passing `docHasHistory` = false,
 *  reaching the raw-apply fast path, and getting its ORDER_KEY entries
 *  doubled by YATA the same way an empty-body check let H1's body double
 *  (round 2 review finding). Do NOT use this for `applyLocalEdit`'s `lca`
 *  decision — it stays body-only there; this predicate exists ONLY for a
 *  raw-apply site's own history gate. */
export function docHasAnyHistory(doc: Y.Doc, kind: "note" | "canvas"): boolean {
	if (docHasHistory(doc, kind)) return true;
	if (kind === "canvas") return false;
	return (
		doc.getArray<string>(ORDER_KEY).length > 0 ||
		doc.getMap<string>(FRONTMATTER_KEY).size > 0 ||
		doc.getMap<string>(RAW_FRONTMATTER_KEY).size > 0
	);
}

/** Upsert parsed frontmatter into the doc's Y.Map/Y.Array (only changed keys
 *  written, absent keys deleted, order replaced). A locally-parsed good value
 *  supersedes any stale degraded raw span for the same key. */
export function applyFrontmatterInto(
	doc: Y.Doc,
	order: string[],
	values: Record<string, string>,
): void {
	const map = doc.getMap<string>(FRONTMATTER_KEY);
	const arr = doc.getArray<string>(ORDER_KEY);
	const rawMap = doc.getMap<string>(RAW_FRONTMATTER_KEY);
	const current = map.toJSON() as Record<string, string>;
	doc.transact(() => {
		for (const [k, v] of Object.entries(values)) {
			if (current[k] !== v) map.set(k, v);
			// A good value supersedes a stale degraded span (else raws-precedence in
			// emitFrontmatter would silently revert the user's edit). Local ingest
			// never produces raws, so this only ever deletes stale entries.
			if (rawMap.has(k)) rawMap.delete(k);
		}
		for (const k of Object.keys(current)) {
			if (!(k in values)) map.delete(k);
		}
		// Guarded like the map upsert above, and for the same reason: a CRDT
		// records ops, not intentions. An unconditional delete+insert of an
		// IDENTICAL order list writes no visible change but still mints ops under
		// THIS device's clientID — and a device that had no ops on this doc
		// becomes a second client, i.e. a second lineage.
		//
		// That is the 2026-08-23 first-sync corruption. `flushFromCrdt` writes the
		// doc's projection back to disk, frontmatter does not round-trip
		// byte-for-byte (`tags: [a, b]` is re-serialised as a block list), so
		// Obsidian fires a real modify; handleModify deliberately skips its
		// recently-flushed guard for CRDT notes on the premise that the echo is "a
		// no-op"; applyLocalEdit then reached here and minted ops. Measured:
		// `textLen 236->236` (body genuinely unchanged) alongside a 31-byte
		// LOCAL-origin update, and the server ended up holding two clients for
		// every note whose YAML did not round-trip — 224 of 316 on a real vault,
		// each note's content stored twice.
		//
		// Order comparison is elementwise: `arr` is a Y.Array of key strings, so
		// `toArray()` is a plain string[] and equality here means "the same keys in
		// the same positions", which is exactly what the delete+insert would have
		// re-established.
		const currentOrder = arr.toArray();
		const orderUnchanged =
			currentOrder.length === order.length && currentOrder.every((k, i) => k === order[i]);
		if (!orderUnchanged) {
			if (arr.length > 0) arr.delete(0, arr.length);
			if (order.length > 0) arr.insert(0, order);
		}
	});
}

/** Ingest a disk-content string into a doc's Y.Text + frontmatter shared types
 *  inside ONE transaction (frontmatter split/parse, then the seed-once +
 *  minimal-diff body gate). ONE transaction so bare ops don't ship a truncated
 *  intermediate state (e2e test_83). `lca` = the doc already has history →
 *  diff; otherwise seed once. */
export function seedContentInto(doc: Y.Doc, text: Y.Text, content: string, lca: boolean): void {
	const { fmBlock, body: splitBody } = splitFrontmatter(content);
	const parsed = fmBlock === null ? null : parseFrontmatter(fmBlock);

	// A null `parsed` means one of two OPPOSITE things, and treating them alike
	// was #483 defect 2:
	//
	//   fmBlock === null  the note genuinely has no frontmatter. Clearing every
	//                     key is correct, or frontmatter could never be removed.
	//   parse failed      the note HAS frontmatter we could not model. Clearing
	//                     every key destroys the user's properties.
	//
	// Both produced order=[] values={}, and `applyFrontmatterInto` deletes every
	// key absent from `values` — so one unparseable block wiped the lot, the
	// projection emitted a body-only note, and the flush wrote that over the
	// file on every device. Half-typed YAML is invalid constantly, so this was
	// reachable by ordinary typing, and the client parse is all-or-nothing: one
	// bad key took out every good one.
	//
	// The server has never behaved this way — `Frontmatter.parse_for_ingest`
	// keeps the good keys and preserves the unparseable one verbatim in the raws
	// map. Matching that per-key behaviour needs a degraded parser the client
	// does not have yet (#483 step 4); until then the honest answer to "I cannot
	// read this" is to leave the frontmatter alone and let the next save retry.
	const unparseable = fmBlock !== null && parsed === null;
	const order = parsed ? parsed.order : [];
	const values = parsed ? parsed.values : {};

	// `splitBody` unconditionally, never `content`. With no block the two are
	// identical (splitFrontmatter returns `body: raw`), and on a FAILED parse
	// `content` pushed the raw `---` fence into the body Y.Text — the
	// fence-in-body shape the server's normalize_doc exists to heal. The block
	// is still frontmatter when it does not parse; it is just frontmatter we
	// are choosing not to touch.
	doc.transact(() => {
		if (!unparseable) applyFrontmatterInto(doc, order, values);
		if (!seedOnce(text, splitBody, lca)) diffIntoYText(text, splitBody);
	});
}

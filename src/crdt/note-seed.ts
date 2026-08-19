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
		if (arr.length > 0) arr.delete(0, arr.length);
		if (order.length > 0) arr.insert(0, order);
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
	const order = parsed ? parsed.order : [];
	const values = parsed ? parsed.values : {};
	const body = parsed !== null ? splitBody : content;
	doc.transact(() => {
		applyFrontmatterInto(doc, order, values);
		if (!seedOnce(text, body, lca)) diffIntoYText(text, body);
	});
}

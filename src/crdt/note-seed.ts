// The disk<->Y.Doc seed/diff codec, extracted from CrdtManager so the Relay-
// model ProviderRegistry reuses the EXACT same logic (byte-identical CRDT ops
// for the same content — a divergent encoding corrupts a note when two lineages
// merge). This is NOT bespoke cruft: it's the hard-won correctness for syncing
// Obsidian's INDEPENDENT disk files across devices, which Relay itself never
// needs (Relay docs are the source of truth; ours mirror files on disk). Pure,
// no Obsidian imports.
import * as Y from "yjs";
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
import { encodeUpdateFrame } from "./wire";

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

/** Encode `content` as a base64 `messageSync` update frame — the genesis body a
 *  brand-new note hands to `crdt_create` so the server can persist it with a
 *  detached doc instead of opening a room (#1409).
 *
 *  Routes through `seedContentInto`, NOT `seedOnce`: frontmatter lives in its own
 *  Y.Map, and seeding the raw string into the body Y.Text would ship the YAML
 *  block as literal body text on every imported note. `encodeUpdateFrame` is the
 *  same codec the live crdt_msg path uses, so the two are byte-identical. */
export function genesisFrameFor(content: string): string {
	const doc = new Y.Doc();
	try {
		seedContentInto(doc, doc.getText(CONTENT_KEY), content, false);
		return encodeUpdateFrame(Y.encodeStateAsUpdate(doc));
	} finally {
		doc.destroy();
	}
}

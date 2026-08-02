import type * as Y from "yjs";
import { canonicalJson } from "./frontmatter-codec";

/**
 * Structural CRDT codec for Obsidian `.canvas` files (JSON Canvas format).
 *
 * A canvas doc keeps its data in per-element Y.Maps keyed by the element's
 * stable `id` — NOT in a body Y.Text like markdown. Stable ids are what let two
 * devices edit different nodes concurrently and merge per-element, instead of
 * char-diffing the JSON (which would corrupt it). Mirrors, structurally, the
 * markdown frontmatter codec: `seedCanvasInto` == `seedContentInto`,
 * `projectCanvas` == `projectNote`.
 *
 * Schema (Y.Doc shared types):
 *   Y.Map   "nodes"        node id  -> node object
 *   Y.Map   "edges"        edge id  -> edge object
 *   Y.Array "nodes_order"  node id order (== array/z-index order on disk)
 *   Y.Array "edges_order"  edge id order
 *   Y.Map   "canvas_meta"  any top-level key other than nodes/edges (forward-compat)
 *
 * Per-node granularity is deliberate (spec 2026-07-23 decision #1): concurrent
 * edits to DIFFERENT nodes both survive; concurrent edits to the SAME node are
 * last-writer-wins on the whole node. Order arrays merge like frontmatter_order.
 */

export const NODES_KEY = "nodes";
export const EDGES_KEY = "edges";
export const NODES_ORDER_KEY = "nodes_order";
export const EDGES_ORDER_KEY = "edges_order";
export const CANVAS_META_KEY = "canvas_meta";

export type CanvasElement = Record<string, unknown> & { id: string };

interface ParsedCanvas {
	nodes: CanvasElement[];
	edges: CanvasElement[];
	meta: Record<string, unknown>;
}

/**
 * Parse a `.canvas` string into structured nodes/edges/meta, or `null` when it
 * is not a mergeable canvas (not an object, nodes/edges not element arrays, or
 * an element without a stable string `id`). `null` means "keep it opaque" — the
 * caller falls back (drift-copy / REST), never a corrupting structural merge.
 */
export function parseCanvas(json: string): ParsedCanvas | null {
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		return null;
	}
	if (data === null || typeof data !== "object" || Array.isArray(data)) return null;

	const obj = data as Record<string, unknown>;
	const nodes = asElements(obj.nodes);
	const edges = asElements(obj.edges);
	if (nodes === null || edges === null) return null;

	const meta: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (k !== NODES_KEY && k !== EDGES_KEY) meta[k] = v;
	}
	return { nodes, edges, meta };
}

// An absent nodes/edges key is a valid empty canvas; a present-but-non-array or
// an element missing a string id is not mergeable.
function asElements(v: unknown): CanvasElement[] | null {
	if (v === undefined) return [];
	if (!Array.isArray(v)) return null;
	const out: CanvasElement[] = [];
	for (const el of v) {
		if (el === null || typeof el !== "object" || Array.isArray(el)) return null;
		const id = (el as Record<string, unknown>).id;
		if (typeof id !== "string") return null;
		out.push(el as CanvasElement);
	}
	return out;
}

/**
 * Save→reconcile: upsert changed nodes/edges by id, delete removed ids, replace
 * the order arrays and canvas_meta — all in ONE transaction so a merge never
 * observes a half-applied canvas. Returns `false` (doc untouched) when the input
 * is not a mergeable canvas.
 */
export function seedCanvasInto(doc: Y.Doc, json: string): boolean {
	const parsed = parseCanvas(json);
	if (parsed === null) return false;

	doc.transact(() => {
		upsertElements(doc.getMap(NODES_KEY), doc.getArray<string>(NODES_ORDER_KEY), parsed.nodes);
		upsertElements(doc.getMap(EDGES_KEY), doc.getArray<string>(EDGES_ORDER_KEY), parsed.edges);
		upsertMeta(doc.getMap(CANVAS_META_KEY), parsed.meta);
	});
	return true;
}

function upsertElements(
	map: Y.Map<CanvasElement>,
	order: Y.Array<string>,
	elements: CanvasElement[],
): void {
	const ids = new Set(elements.map((e) => e.id));
	for (const el of elements) {
		// Only write a changed element — an identical re-set would ship a needless
		// Yjs op (and, on the same node, clobber a concurrent edit for no reason).
		const cur = map.get(el.id);
		if (cur === undefined || !jsonEqual(cur, el)) map.set(el.id, el);
	}
	for (const id of [...map.keys()]) {
		if (!ids.has(id)) map.delete(id);
	}
	// Replace the order array wholesale (small list; mirrors applyFrontmatterInto)
	// — but only when it actually changed: an identical rewrite ships a needless
	// delete+insert op pair (and grows tombstones) on every no-op re-ingest.
	const nextOrder = elements.map((e) => e.id);
	if (!jsonEqual(order.toArray(), nextOrder)) {
		if (order.length > 0) order.delete(0, order.length);
		if (nextOrder.length > 0) order.insert(0, nextOrder);
	}
}

function upsertMeta(map: Y.Map<unknown>, meta: Record<string, unknown>): void {
	for (const [k, v] of Object.entries(meta)) {
		if (!jsonEqual(map.get(k), v)) map.set(k, v);
	}
	for (const k of [...map.keys()]) {
		if (!(k in meta)) map.delete(k);
	}
}

/**
 * Pull→project: rebuild the `.canvas` file from the Y.Maps. Serialized to match
 * Obsidian (tab indent, nodes-before-edges). ponytail: the exact whitespace is a
 * calibration knob, not correctness — the codec parses JSON structurally on the
 * way IN, so a format mismatch produces no structural delta (no echo loop);
 * matched here only so a pull writes a file Obsidian re-reads without reformat.
 */
export function projectCanvas(doc: Y.Doc): string {
	const meta = doc.getMap<unknown>(CANVAS_META_KEY).toJSON();
	const nodes = orderedElements(doc.getMap(NODES_KEY), doc.getArray<string>(NODES_ORDER_KEY));
	const edges = orderedElements(doc.getMap(EDGES_KEY), doc.getArray<string>(EDGES_ORDER_KEY));
	return JSON.stringify({ ...meta, nodes, edges }, null, "\t");
}

/** Elements in order-array order, then any map entries the order array missed
 *  (a merge could add to the map and the order array separately) — so a node is
 *  never silently dropped from disk. */
function orderedElements(map: Y.Map<CanvasElement>, order: Y.Array<string>): CanvasElement[] {
	const out: CanvasElement[] = [];
	const seen = new Set<string>();
	for (const id of order.toArray()) {
		const el = map.get(id);
		if (el !== undefined && !seen.has(id)) {
			out.push(el);
			seen.add(id);
		}
	}
	for (const id of [...map.keys()].sort()) {
		if (!seen.has(id)) out.push(map.get(id) as CanvasElement);
	}
	return out;
}

/** Read helpers (parallel to frontmatterOf) — used by the manager + tests. */
export function nodesOf(doc: Y.Doc): CanvasElement[] {
	return orderedElements(doc.getMap(NODES_KEY), doc.getArray<string>(NODES_ORDER_KEY));
}

export function edgesOf(doc: Y.Doc): CanvasElement[] {
	return orderedElements(doc.getMap(EDGES_KEY), doc.getArray<string>(EDGES_ORDER_KEY));
}

/** True when the doc carries no canvas structure yet (fresh/unseeded). The
 *  canvas analog of `text.length > 0` for the empty-genesis flush guard. */
export function canvasIsEmpty(doc: Y.Doc): boolean {
	return doc.getMap(NODES_KEY).size === 0 && doc.getMap(EDGES_KEY).size === 0;
}

/** Key-order-insensitive: two devices serializing the same node with
 *  different key order must compare equal, or the changed-element guard above
 *  re-sets the whole element and LWW-clobbers a concurrent edit for no reason. */
function jsonEqual(a: unknown, b: unknown): boolean {
	return canonicalJson(a) === canonicalJson(b);
}

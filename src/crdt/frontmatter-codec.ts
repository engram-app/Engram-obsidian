// Pure codec between a note's YAML frontmatter and the CRDT Y.Map form. Mirrors
// the backend Elixir Engram.Notes.Frontmatter. No Obsidian imports so it is
// unit-testable under bun and reusable.

import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type * as Y from "yjs";

// ---------------------------------------------------------------------------
// Y.Doc shared-type keys + accessors — the single source of truth (was
// duplicated across CrdtManager and the Relay-model registry). The keys must
// match the backend CrdtBridge exactly so IndexedDB stores and wire frames stay
// compatible.
// ---------------------------------------------------------------------------

/** Y.Doc shared-type key for the frontmatter key-value map. */
export const FRONTMATTER_KEY = "frontmatter";
/** Y.Doc shared-type key for the out-of-band degraded-key raw-passthrough map
 *  (keys the backend could not parse as YAML → verbatim source spans). */
export const RAW_FRONTMATTER_KEY = "frontmatter_raw";
/** Y.Doc shared-type key for the ordered list of frontmatter keys. */
export const ORDER_KEY = "frontmatter_order";
/** Y.Doc shared-type key for the note body text. */
export const CONTENT_KEY = "content";

/** Read the frontmatter structure from a Y.Doc ({order:[],values:{}} when empty). */
export function frontmatterOf(doc: Y.Doc): { order: string[]; values: Record<string, string> } {
	const order = doc.getArray<string>(ORDER_KEY).toArray();
	const values = doc.getMap<string>(FRONTMATTER_KEY).toJSON() as Record<string, string>;
	return { order, values };
}

/** Read the out-of-band degraded-key raw spans from a Y.Doc ({} when none). */
export function rawFrontmatterOf(doc: Y.Doc): Record<string, string> {
	return doc.getMap<string>(RAW_FRONTMATTER_KEY).toJSON();
}

const FENCE = "---";
// Matches a closing fence line: --- with optional trailing spaces/tabs + optional CR.
const CLOSE_MID = /\n---[ \t]*\r?\n/;
const CLOSE_EOF = /\n---[ \t]*\r?$/;

export function splitFrontmatter(raw: string): { fmBlock: string | null; body: string } {
	if (!raw.startsWith(`${FENCE}\n`)) return { fmBlock: null, body: raw };
	const rest = raw.slice(FENCE.length + 1);
	// Empty frontmatter fast path: rest begins with the closing fence.
	if (rest.startsWith(`${FENCE}\n`)) return { fmBlock: "", body: rest.slice(FENCE.length + 1) };
	const mid = rest.match(CLOSE_MID);
	if (mid && mid.index !== undefined) {
		const block = `${rest.slice(0, mid.index)}\n`;
		const body = rest.slice(mid.index + mid[0].length);
		return { fmBlock: block, body };
	}
	const eof = rest.match(CLOSE_EOF);
	if (eof && eof.index !== undefined) {
		return { fmBlock: `${rest.slice(0, eof.index)}\n`, body: "" };
	}
	return { fmBlock: null, body: raw };
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(sortDeep);
	if (v !== null && typeof v === "object") {
		const rec = v as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(rec).sort()) {
			out[k] = sortDeep(rec[k]);
		}
		return out;
	}
	return v;
}

export function parseFrontmatter(
	fmBlock: string,
): { order: string[]; values: Record<string, string> } | null {
	if (fmBlock === "") return { order: [], values: {} };
	let doc: unknown;
	try {
		doc = yamlParse(fmBlock);
	} catch {
		return null;
	}
	if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
	const map = doc as Record<string, unknown>;
	const order = topLevelKeyOrder(fmBlock, map);
	const values: Record<string, string> = {};
	for (const k of Object.keys(map)) values[k] = canonicalJson(map[k]);
	return { order, values };
}

// Recover source order: top-level keys appear as `key:` at column 0.
function topLevelKeyOrder(block: string, map: Record<string, unknown>): string[] {
	const order: string[] = [];
	for (const line of block.split("\n")) {
		const m = line.match(/^([^\s:][^:]*):/);
		if (!m) continue;
		const key = m[1];
		if (
			key !== undefined &&
			Object.prototype.hasOwnProperty.call(map, key) &&
			!order.includes(key)
		) {
			order.push(key);
		}
	}
	return order;
}

function ensureTrailingNewline(s: string): string {
	if (s === "") return "";
	return s.endsWith("\n") ? s : `${s}\n`;
}

// Emit a single GOOD key as canonical YAML (its value is a JSON string). One key
// per call so raw spans can interleave in source order, mirroring the backend
// Frontmatter.emit_key/2.
function emitKey(key: string, valueJson: string): string {
	const value: unknown = JSON.parse(valueJson);
	return ensureTrailingNewline(yamlStringify({ [key]: value }));
}

// `raws` holds DEGRADED keys the backend could not parse as YAML, mapped to
// their verbatim source spans (stored out-of-band from `values` in the note's
// `frontmatter_raw` Y.Map). A degraded key is in `order` but NOT in `values`,
// so it must be re-rendered verbatim here or it is silently dropped. Mirrors
// the backend Engram.Notes.Frontmatter.emit/3.
export function emitFrontmatter(
	order: string[],
	values: Record<string, string>,
	raws: Record<string, string> = {},
): string {
	const has = (m: Record<string, string>, k: string) =>
		Object.prototype.hasOwnProperty.call(m, k);
	const present = order.filter((k) => has(raws, k) || has(values, k));
	if (present.length === 0) return "";
	let out = "";
	for (const key of present) {
		// A degraded key re-renders from its verbatim span (never via the YAML
		// emitter, which would canonicalize/lose it). Raws take precedence so a
		// stale good-value shadow can never override the source-of-truth span.
		out += has(raws, key) ? ensureTrailingNewline(raws[key]!) : emitKey(key, values[key]!);
	}
	return ensureTrailingNewline(out);
}

export function projectNote(
	order: string[],
	values: Record<string, string>,
	body: string,
	raws: Record<string, string> = {},
): string {
	const block = emitFrontmatter(order, values, raws);
	return block === "" ? body : `${FENCE}\n${block}${FENCE}\n${body}`;
}

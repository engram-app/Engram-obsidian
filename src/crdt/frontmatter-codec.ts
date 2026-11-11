// Pure codec between a note's YAML frontmatter and the CRDT Y.Map form. Mirrors
// the backend Elixir Engram.Notes.Frontmatter. No Obsidian imports so it is
// unit-testable under bun and reusable.

import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type * as Y from "yjs";

// ---------------------------------------------------------------------------
// Y.Doc shared-type keys + accessors — the single source of truth (was
// duplicated across CrdtManager and the provider-model registry). The keys must
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

// Length of an opening fence (`---` then LF or CRLF) at the start of `s`, else 0.
function openFence(s: string): number {
	if (s.startsWith(`${FENCE}\r\n`)) return FENCE.length + 2;
	return s.startsWith(`${FENCE}\n`) ? FENCE.length + 1 : 0;
}

/** The one frontmatter fence rule in the plugin; every caller routes here. A
 *  copy of the backend's (engram_core::frontmatter::split) and the web app's
 *  splitFrontmatter: opens at byte 0 on a bare `---` line (LF or CRLF), closes
 *  on `---` plus optional spaces/tabs, or at end of text. `---foo`/`----` never
 *  close; a leading BOM is NOT skipped. tests/frontmatter-fence-table.test.ts
 *  asserts the backend's shared fixture table. */
export function splitFrontmatter(raw: string): { fmBlock: string | null; body: string } {
	const start = openFence(raw);
	if (start === 0) return { fmBlock: null, body: raw };
	const rest = raw.slice(start);
	// Empty frontmatter fast path: rest begins with the closing fence.
	const empty = openFence(rest);
	if (empty > 0) return { fmBlock: "", body: rest.slice(empty) };
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

/** A frontmatter block is one of three things, and they need OPPOSITE handling.
 *
 *  `parseFrontmatter` collapses all three into `null`, which is what made #483
 *  defect 2 possible and then, in its first fix, reintroduced the same class in
 *  reverse: treating every null as "leave the keys alone" meant EMPTYING a
 *  properties block (`---\n\n---`, the ordinary way to clear one in Source
 *  mode) silently resurrected every key from the doc.
 *
 *    empty     the block holds no mapping -- blank, whitespace, comments only.
 *              The user removed their properties. Clearing is correct.
 *    ok        a mapping, possibly with zero keys. Apply it.
 *    degraded  YAML we cannot model: a syntax error mid-typing, or a valid
 *              document that is not a mapping (a list, a bare scalar). Keep
 *              what the doc already has; the user is mid-edit and the block
 *              will parse again in a moment. */
export type FrontmatterParse =
	| { kind: "ok"; order: string[]; values: Record<string, string> }
	| { kind: "empty" }
	| { kind: "degraded" };

export function parseFrontmatterBlock(fmBlock: string): FrontmatterParse {
	if (fmBlock.trim() === "") return { kind: "empty" };
	let doc: unknown;
	try {
		doc = yamlParse(fmBlock);
	} catch {
		return { kind: "degraded" };
	}
	// yaml returns null/undefined for a block that is only comments or blank
	// lines. That is an EMPTY mapping, not a broken one.
	if (doc === null || doc === undefined) return { kind: "empty" };
	if (typeof doc !== "object" || Array.isArray(doc)) return { kind: "degraded" };
	const map = doc as Record<string, unknown>;
	const order = topLevelKeyOrder(fmBlock, map);
	const values: Record<string, string> = {};
	for (const k of Object.keys(map)) values[k] = canonicalJson(map[k]);
	return { kind: "ok", order, values };
}

/** Back-compat shape for callers that only need "did it give me a mapping".
 *  Prefer `parseFrontmatterBlock`: this cannot tell empty from broken. */
export function parseFrontmatter(
	fmBlock: string,
): { order: string[]; values: Record<string, string> } | null {
	const result = parseFrontmatterBlock(fmBlock);
	if (result.kind === "ok") return { order: result.order, values: result.values };
	if (result.kind === "empty") return { order: [], values: {} };
	return null;
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
			// biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn needs lib ES2022, we target ES2021
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
		// biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn needs lib ES2022, we target ES2021
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

/** Do two frontmatter blocks (`splitFrontmatter`'s `fmBlock`) MEAN the same?
 *  Parsed with `parseFrontmatterBlock`, so YAML formatting (flow vs block
 *  lists, spacing, quoting, comments) does not count: same keys in the same
 *  order with the same canonical values. No block and an empty one match.
 *  A block that does not parse only matches itself byte for byte. */
function sameFrontmatterMeaning(a: string | null, b: string | null): boolean {
	if (a === b) return true;
	const pa = a === null ? ({ kind: "empty" } as const) : parseFrontmatterBlock(a);
	const pb = b === null ? ({ kind: "empty" } as const) : parseFrontmatterBlock(b);
	if (pa.kind === "empty" || pb.kind === "empty") return pa.kind === pb.kind;
	if (pa.kind !== "ok" || pb.kind !== "ok") return false;
	return (
		canonicalJson(pa.order) === canonicalJson(pb.order) &&
		canonicalJson(pa.values) === canonicalJson(pb.values)
	);
}

/** `next` carrying `disk`'s own frontmatter bytes when the two blocks mean the
 *  same (see `sameFrontmatterMeaning`); otherwise `next` unchanged. A write
 *  built from the doc's projection then never rewrites YAML the user wrote
 *  (comments, flow lists, spacing) that the doc only re-serialised. */
export function keepDiskFrontmatter(next: string, disk: string): string {
	if (next === disk) return next;
	const n = splitFrontmatter(next);
	const d = splitFrontmatter(disk);
	if (!sameFrontmatterMeaning(n.fmBlock, d.fmBlock)) return next;
	return disk.slice(0, disk.length - d.body.length) + n.body;
}

/** What a flush of `projection` leaves on disk, and the projection itself.
 *  The ONE owner of that answer (`writeCrdtNote`, the registry write-back and
 *  the create-ack baselines all ask it): a CRDT write keeps disk's own
 *  frontmatter bytes when they mean the same, so `onDisk` is the projection
 *  with disk's block, or the bare projection when disk is unknown (`null`)
 *  or means something else. Callers pick by use: `projection` is what the
 *  doc holds (a merge's "expected" text), `onDisk` is what disk holds (a
 *  baseline, a merge base). Mixing them is how a baseline names bytes no
 *  file holds, or a merge refuses its own doc. */
export function flushTarget(
	projection: string,
	disk: string | null,
): { projection: string; onDisk: string } {
	return {
		projection,
		onDisk: disk === null ? projection : keepDiskFrontmatter(projection, disk),
	};
}

/** Do two note texts mean the same: identical bodies and frontmatter that
 *  differs only in YAML formatting? */
export function sameNoteMeaning(a: string, b: string): boolean {
	return keepDiskFrontmatter(a, b) === b;
}

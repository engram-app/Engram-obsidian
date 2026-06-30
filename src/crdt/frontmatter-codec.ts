// Pure codec between a note's YAML frontmatter and the CRDT Y.Map form. Mirrors
// the backend Elixir Engram.Notes.Frontmatter. No Obsidian imports so it is
// unit-testable under bun and reusable.

import { parse as yamlParse, stringify as yamlStringify } from "yaml";

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
	if (v && typeof v === "object") {
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(v as Record<string, unknown>).sort()) {
			out[k] = sortDeep((v as Record<string, unknown>)[k]);
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
		if (m && Object.prototype.hasOwnProperty.call(map, m[1]) && !order.includes(m[1])) {
			order.push(m[1]);
		}
	}
	return order;
}

export function emitFrontmatter(order: string[], values: Record<string, string>): string {
	const present = order.filter((k) => Object.prototype.hasOwnProperty.call(values, k));
	if (present.length === 0) return "";
	// Build one object in source order; `yaml.stringify` preserves insertion order.
	const obj: Record<string, unknown> = {};
	for (const k of present) obj[k] = JSON.parse(values[k]);
	const out = yamlStringify(obj);
	return out.endsWith("\n") ? out : `${out}\n`;
}

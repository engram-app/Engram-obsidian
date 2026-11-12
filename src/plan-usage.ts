/**
 * plan-usage.ts — shaping `GET /api/billing/usage` into Sync Center rows.
 *
 * Pure on purpose: the Sync Center renders under Obsidian's HTMLElement
 * extensions, which the unit suite does not have, so everything worth testing
 * lives here and the renderer just walks the result.
 *
 * The point of the panel is that a Free user should be able to see where they
 * stand BEFORE anything refuses them.
 */
import { t } from "./i18n";

/** One `{used, limit}` pair off the wire. `limit: null` == unlimited. */
export interface UsageEntry {
	used: number | null;
	limit: number | null;
}

export interface BillingUsage {
	tier: string;
	usage: Record<string, UsageEntry | undefined>;
}

export interface UsageRow {
	label: string;
	/** Display string, e.g. "300 / 2,000" or "12.4 MB / 1.0 GB". */
	value: string;
	/** 0..1 for a meter, or null when there is nothing to fill against. */
	fraction: number | null;
	/** At or over the limit. Drives the warning style. */
	atLimit: boolean;
}

/** `null` and negative both mean unlimited; negative is the backend sentinel
 *  and must never read as a literal limit. Mirrors `Billing.@no_cap`. */
export function isUnlimited(limit: number | null): boolean {
	return limit === null || limit < 0;
}

function count(n: number): string {
	return n.toLocaleString();
}

/** Bytes to a short human string. THE one implementation.
 *
 *  This lived here and in sync-center-render as byte-identical twins, on the
 *  reasoning that the renderer pulls in Obsidian and cannot load in the unit
 *  suite. That had the dependency backwards: this module imports nothing, so
 *  the renderer imports IT. The two must not drift regardless — their outputs
 *  sit in the same Stats grid, and a GB shown to one decimal beside one shown
 *  to two reads as a bug. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Per-row display options. */
export interface RowOpts {
	/** Prepended to the value, before the used/limit pair. Lets one row carry a
	 *  second measure of the same subject — "24 files · 12.4 MB / 1.00 GB" — so
	 *  a count and a quota do not need two rows saying "attachments". */
	prefix?: string;
}

/** Build one row, or null when there is nothing worth showing. */
export function buildRow(
	label: string,
	entry: UsageEntry | undefined,
	fmt: (n: number) => string,
	opts: RowOpts = {},
): UsageRow | null {
	if (!entry) return null;
	const { used, limit } = entry;
	const { prefix = "" } = opts;

	if (isUnlimited(limit)) {
		// Bare count, not "1,240 / unlimited". A paid user has no limit to read
		// against, and the word only draws the eye to a constraint that does
		// not exist.
		if (used === null) return null;
		return { label, value: `${prefix}${fmt(used)}`, fraction: null, atLimit: false };
	}

	const cap = limit as number;
	// `ai_searches.used` is deliberately null on the wire: the counter is a
	// token bucket with no read-without-spend API, so asking how much is left
	// would consume some. Show the cap alone rather than inventing a number.
	// Bare, not "20 max": the label carries the unit, and "max" beside four
	// "used / limit" rows reads as a different kind of number than it is.
	if (used === null) {
		return { label, value: `${prefix}${fmt(cap)}`, fraction: null, atLimit: false };
	}

	return {
		label,
		value: `${prefix}${fmt(used)} / ${fmt(cap)}`,
		fraction: cap === 0 ? 1 : Math.min(1, used / cap),
		atLimit: used >= cap,
	};
}

/**
 * The Sync Center plan rows, in the order a Free user cares about them.
 *
 * No "Notes searchable" row: every stored note is searchable on every plan.
 * Past the plan's passage budget the least recently edited notes fall to
 * keyword-only search, still found. `indexed_notes` stays on the wire as a
 * compat shim with `limit: nil`, so a row for it could only ever show a cap
 * the backend no longer has.
 */
export function planUsageRows(
	data: BillingUsage,
	opts: { localAttachmentCount?: number } = {},
): UsageRow[] {
	const u = data.usage ?? {};
	// Attachments had two rows: a local file COUNT and a server BYTE quota. The
	// two are never comparable, so neither could be dropped the way the
	// duplicate note count was — but they answer one question ("how much of my
	// attachment allowance am I using, and across how many files?"), so they
	// belong on one line.
	const attachPrefix =
		opts.localAttachmentCount === undefined
			? undefined
			: `${t("{count} files", { count: opts.localAttachmentCount })} · `;
	const rows = [
		buildRow(t("Notes stored"), u.notes, count),
		// No Vaults row. On Free it is permanently "1 / 1" — a meter pinned at
		// full for a limit the user is not near and cannot act on, sitting in a
		// panel whose whole job is showing headroom. It reads as a warning about
		// nothing. The cap still refuses a second vault server-side, with copy
		// that explains itself at the moment it matters.
		buildRow(t("Attachments"), u.attachment_bytes, formatBytes, { prefix: attachPrefix }),
		// "AI searches: 20 per day", not "AI searches / day: 20". This row is the
		// one that shows a CEILING with no usage beside it (the token bucket has
		// no read-without-spend API), so a bare number under a label ending in
		// "/ day" read as "you have run 20 today" — the opposite of what it is.
		// The unit rides on the value, where the reader is already looking.
		//
		// Carried by `fmt` rather than a suffix option: `used` is nil by
		// contract here, so the formatter is only ever applied to the cap.
		buildRow(t("AI searches"), u.ai_searches, (n) =>
			t("{formatted} per day", { formatted: count(n) }),
		),
	];
	return rows.filter((r): r is UsageRow => r !== null);
}

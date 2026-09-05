/**
 * plan-usage.ts — shaping `GET /api/billing/usage` into Sync Center rows.
 *
 * Pure on purpose: the Sync Center renders under Obsidian's HTMLElement
 * extensions, which the unit suite does not have, so everything worth testing
 * lives here and the renderer just walks the result.
 *
 * The point of the panel is that a Free user should be able to see where they
 * stand BEFORE anything refuses them. `indexed_notes_cap` refuses nothing at
 * all — notes past it sync, open and edit normally and are simply absent from
 * search — so a user who is never shown the number only discovers it as a
 * search that cannot find something they know they wrote.
 */

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
	/** Longer explanation, shown under the row. */
	hint?: string;
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

/** Per-row policy for what an unlimited plan should do with this row. */
export interface RowOpts {
	hint?: string;
	/** Prepended to the value, before the used/limit pair. Lets one row carry a
	 *  second measure of the same subject — "24 files · 12.4 MB / 1.00 GB" — so
	 *  a count and a quota do not need two rows saying "attachments". */
	prefix?: string;
	/** Drop the row entirely when the limit is unlimited.
	 *
	 *  For rows whose only content IS the limit. "Notes searchable" on a paid
	 *  plan is every note the user has, which the row directly below already
	 *  says, so it would be a duplicate dressed up as a constraint. */
	hideWhenUnlimited?: boolean;
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
	const { hint, hideWhenUnlimited, prefix = "" } = opts;

	if (isUnlimited(limit)) {
		if (hideWhenUnlimited) return null;
		// Bare count, not "1,240 / unlimited". A paid user has no limit to read
		// against, and the word only draws the eye to a constraint that does
		// not exist.
		if (used === null) return null;
		return { label, value: `${prefix}${fmt(used)}`, fraction: null, atLimit: false, hint };
	}

	const cap = limit as number;
	// `ai_searches.used` is deliberately null on the wire: the counter is a
	// token bucket with no read-without-spend API, so asking how much is left
	// would consume some. Show the cap alone rather than inventing a number.
	// Bare, not "20 max": the label carries the unit, and "max" beside four
	// "used / limit" rows reads as a different kind of number than it is.
	if (used === null) {
		return { label, value: `${prefix}${fmt(cap)}`, fraction: null, atLimit: false, hint };
	}

	return {
		label,
		value: `${prefix}${fmt(used)} / ${fmt(cap)}`,
		fraction: cap === 0 ? 1 : Math.min(1, used / cap),
		atLimit: used >= cap,
		hint,
	};
}

/**
 * The Sync Center plan rows, in the order a Free user cares about them.
 *
 * Searchable notes leads because it is the limit that binds first on Free and
 * the only one that fails silently. Stored notes follows so the pair reads as
 * "everything is synced, not all of it is searchable", which is the true and
 * non-alarming version of that fact.
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
			: `${count(opts.localAttachmentCount)} ${opts.localAttachmentCount === 1 ? "file" : "files"} · `;
	const rows = [
		// Hidden on paid: with no index cap, "searchable" equals "stored", and the
		// row below already says that. Shown on Free because it is the limit that
		// binds first and the only one that refuses nothing.
		buildRow("Notes searchable", u.indexed_notes, count, {
			hideWhenUnlimited: true,
			hint: "Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.",
		}),
		buildRow("Notes stored", u.notes, count),
		// No Vaults row. On Free it is permanently "1 / 1" — a meter pinned at
		// full for a limit the user is not near and cannot act on, sitting in a
		// panel whose whole job is showing headroom. It reads as a warning about
		// nothing. The cap still refuses a second vault server-side, with copy
		// that explains itself at the moment it matters.
		buildRow("Attachments", u.attachment_bytes, formatBytes, { prefix: attachPrefix }),
		// "AI searches: 20 per day", not "AI searches / day: 20". This row is the
		// one that shows a CEILING with no usage beside it (the token bucket has
		// no read-without-spend API), so a bare number under a label ending in
		// "/ day" read as "you have run 20 today" — the opposite of what it is.
		// The unit rides on the value, where the reader is already looking.
		//
		// Carried by `fmt` rather than a suffix option: `used` is nil by
		// contract here, so the formatter is only ever applied to the cap.
		buildRow("AI searches", u.ai_searches, (n) => `${count(n)} per day`),
	];
	return rows.filter((r): r is UsageRow => r !== null);
}

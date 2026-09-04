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

/** Bytes to a short human string. Must stay byte-identical to the renderer's
 *  own `formatBytes`, since these rows sit in the same Stats grid as the local
 *  counts and a GB shown to one decimal beside one shown to two reads as a
 *  bug. Duplicated rather than imported because that module pulls in Obsidian
 *  and cannot load in the unit suite. */
export function formatBytesShort(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Build one row, or null when there is nothing worth showing.
 *
 *  An unlimited limit still produces a row when we know the usage, because
 *  "1,240 notes, unlimited" is useful reassurance on a paid plan. It produces
 *  NOTHING when usage is also unknown, since "unlimited / unknown" is noise. */
export function buildRow(
	label: string,
	entry: UsageEntry | undefined,
	fmt: (n: number) => string,
	hint?: string,
): UsageRow | null {
	if (!entry) return null;
	const { used, limit } = entry;

	if (isUnlimited(limit)) {
		if (used === null) return null;
		return { label, value: `${fmt(used)} / unlimited`, fraction: null, atLimit: false, hint };
	}

	const cap = limit as number;
	// `ai_searches.used` is deliberately null on the wire: the counter is a
	// token bucket with no read-without-spend API, so asking how much is left
	// would consume some. Show the cap alone rather than inventing a number.
	if (used === null) {
		return { label, value: `${fmt(cap)} max`, fraction: null, atLimit: false, hint };
	}

	return {
		label,
		value: `${fmt(used)} / ${fmt(cap)}`,
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
export function planUsageRows(data: BillingUsage): UsageRow[] {
	const u = data.usage ?? {};
	const rows = [
		buildRow(
			"Notes searchable",
			u.indexed_notes,
			count,
			"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.",
		),
		buildRow("Notes stored", u.notes, count),
		buildRow("Vaults", u.vaults, count),
		buildRow("Attachments", u.attachment_bytes, formatBytesShort),
		buildRow("AI searches per day", u.ai_searches, count),
	];
	return rows.filter((r): r is UsageRow => r !== null);
}

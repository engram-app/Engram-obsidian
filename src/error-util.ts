/** Coerce an unknown caught value to a printable string for logs and UI. */
export function errMsg(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (typeof e === "string") return e;
	try {
		return JSON.stringify(e) ?? String(e);
	} catch {
		return String(e);
	}
}

/** The HTTP status carried by a rejected Obsidian requestUrl() call, or
 *  undefined for non-HTTP failures (network loss, timeout). Null-safe: a
 *  nullish rejection yields undefined, never a TypeError. */
export function statusOf(e: unknown): number | undefined {
	if (typeof e !== "object" || e === null) return undefined;
	const s = (e as { status?: unknown }).status;
	return typeof s === "number" ? s : undefined;
}

/** True when the caught value is an HTTP response with the given status. */
export function isHttpStatus(e: unknown, status: number): boolean {
	return statusOf(e) === status;
}

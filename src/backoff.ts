/** Capped exponential backoff: base, base*2, base*4, ... never above `capMs`.
 *  `attempt` is the count of consecutive failures so far (0 = first delay).
 *  The one implementation — this arithmetic existed in three attempt-counted
 *  variants (offline health probe, connect preflight retry, CRDT op queue).
 *  The channel's two in-place doubling accumulators are a different shape
 *  (stateful, reset on distinct events) and deliberately stay local. */
export function expBackoff(baseMs: number, attempt: number, capMs: number): number {
	return Math.min(baseMs * 2 ** attempt, capMs);
}

/**
 * LimitExceededError — thrown by api.ts when the backend returns HTTP 402.
 *
 * Carries the standardized 402 body shape (spec §4.6) so call sites can route
 * on `reason` for toasts (`limit-copy.ts`), launch the upgrade flow via
 * `upgradeUrl`, or surface tier context in the Sync Center without re-parsing.
 *
 * Field nullability matches the wire shape:
 *   - `reason` is always present (we default to `"unknown"` when the body is
 *     malformed so the toast handler always has something to map).
 *   - The others may be absent for certain reasons (e.g. boolean limits like
 *     `attachments_disabled` don't carry a numeric `current`).
 */
export class LimitExceededError extends Error {
	readonly name = "LimitExceededError";
	/** HTTP status that produced this error. Always 402 (the limit status). */
	readonly status = 402;

	constructor(
		public readonly reason: string,
		public readonly upgradeUrl: string | null,
		public readonly limitKey: string | null,
		public readonly limit: number | boolean | null,
		public readonly current: number | null,
	) {
		super(`Engram limit: ${reason}`);
	}
}

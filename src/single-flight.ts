/** Returns a guard that runs `fn` only when no prior invocation is still in
 *  flight. Concurrent calls while one is running resolve to `undefined`
 *  without invoking `fn`. The in-flight flag clears in a `finally`, so a
 *  thrown `fn` does not wedge the guard shut. Used to stop the
 *  SyncPreviewModal from opening twice on a vault switch. */
export function createSingleFlight(): <T>(fn: () => Promise<T>) => Promise<T | undefined> {
	let inFlight = false;
	return async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
		if (inFlight) return undefined;
		inFlight = true;
		try {
			return await fn();
		} finally {
			inFlight = false;
		}
	};
}

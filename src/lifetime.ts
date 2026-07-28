/**
 * Lifetime — an ownership window you can end, and guard async work against.
 *
 * Ported from Relay (`src/promiseUtils.ts`). Our version of this is four
 * hand-written `if (entry.destroyed) return;` checks in provider-registry,
 * each re-derived at a different call site, each added after a bug taught us it
 * was missing. Hand-written liveness is missed by construction — the
 * entry-creation path had none, which is how a deleted note's room got rebuilt
 * and materialized an empty file.
 *
 * The post-await check is also weaker than it looks: it only notices the owner
 * died AFTER the awaited work resolves. `guard` races the operation against the
 * end signal, so the continuation is abandoned the moment the lifetime ends —
 * it never resumes into dead state at all.
 */

export type LifetimeOperation<T> = Promise<T> | ((signal: AbortSignal) => Promise<T>);

/** Preserve a real Error unchanged; wrap anything else so a rejection is always
 *  catchable by type. Identity is kept for Errors, so `rejects.toThrow(Foo)`
 *  and `instanceof` checks at call sites still work. */
const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

export class Lifetime {
	private ended = false;
	private endReason: Error | undefined;
	private readonly controller = new AbortController();
	private readonly endListeners = new Set<(reason: Error) => void>();

	get signal(): AbortSignal {
		return this.controller.signal;
	}

	get active(): boolean {
		return !this.ended;
	}

	get reason(): Error | undefined {
		return this.endReason;
	}

	/** The rejection value. A lifetime always ends WITH a reason in practice
	 *  (NoteDestroyedError); the fallback keeps the reject type honestly `Error`
	 *  rather than `unknown`, so callers can catch on type. */
	private get rejection(): Error {
		return this.endReason ?? new Error("Lifetime ended");
	}

	/** Subscribe to the end. Fires immediately if already ended. Returns an
	 *  unsubscribe. */
	onEnded(listener: (reason: Error) => void): () => void {
		if (this.ended) {
			listener(this.rejection);
			return () => {};
		}
		this.endListeners.add(listener);
		return () => {
			this.endListeners.delete(listener);
		};
	}

	/** Run `operation` under this lifetime. Rejects with the end reason if the
	 *  lifetime is already over, or the instant it ends — whichever comes first —
	 *  rather than waiting for the operation to settle into a dead owner. */
	guard<T>(operation: LifetimeOperation<T>): Promise<T> {
		if (this.ended) return Promise.reject(this.rejection);

		let promise: Promise<T>;
		try {
			promise = typeof operation === "function" ? operation(this.signal) : operation;
		} catch (error) {
			return Promise.reject(asError(error));
		}

		if (this.ended) {
			// Ended while the operation was starting. Observe its settlement so a
			// later rejection isn't an unhandled rejection; discard the result.
			void promise.catch(() => {});
			return Promise.reject(this.rejection);
		}

		return new Promise<T>((resolve, reject) => {
			let settled = false;
			const finish = (fn: () => void) => {
				if (settled) return;
				settled = true;
				this.signal.removeEventListener("abort", onEnd);
				fn();
			};
			const onEnd = () => finish(() => reject(this.rejection));

			this.signal.addEventListener("abort", onEnd, { once: true });
			promise.then(
				(value) => finish(() => resolve(value)),
				(error: unknown) => finish(() => reject(asError(error))),
			);
		});
	}

	end(reason: Error): void {
		if (this.ended) return;
		this.ended = true;
		this.endReason = reason;
		this.controller.abort();
		for (const listener of Array.from(this.endListeners)) listener(reason);
		this.endListeners.clear();
	}
}

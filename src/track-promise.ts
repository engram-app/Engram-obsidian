/**
 * Labelled registry of in-flight promises, plus a bounded ring of recent
 * completions.
 *
 * Ported from Relay (`src/trackPromise.ts`). It answers one question we
 * currently cannot answer at all: *what async work is still outstanding right
 * now?* A wedged sync shows up as a pending entry with a large `ageMs`, which
 * is a far shorter path than reading the logs backwards trying to infer which
 * await never returned.
 *
 * ponytail: gated on the existing `DEV_MODE` esbuild define rather than a new
 * `BUILD_TYPE` one. `trackPromise` compiles to an identity function in
 * production, so instrumenting a hot path costs nothing shipped.
 */

declare const DEV_MODE: boolean;

interface TrackedEntry {
	label: string;
	created: number;
}

export interface PendingEntry {
	label: string;
	ageMs: number;
}

export interface CompletedEntry {
	label: string;
	created: number;
	settledAt: number;
	state: "fulfilled" | "rejected";
}

export interface PromiseTrackerOpts {
	/** Ring capacity for completions. */
	capacity?: number;
	/** Injected clock, so age assertions don't depend on wall time. */
	now?: () => number;
}

const DEFAULT_CAPACITY = 500;

export class PromiseTracker {
	private readonly tracked = new Map<number, TrackedEntry>();
	private readonly completed: CompletedEntry[] = [];
	private readonly capacity: number;
	private readonly now: () => number;
	private nextId = 0;
	private destroyed = false;

	constructor(opts: PromiseTrackerOpts = {}) {
		this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
		this.now = opts.now ?? (() => Date.now());
	}

	/**
	 * Register `p` under `label` and hand it straight back.
	 *
	 * The returned promise is the SAME promise, not a wrapper — the caller keeps
	 * ownership of the rejection. The internal `.then` attaches its own handlers
	 * so a tracked rejection is observed here (no spurious unhandled-rejection
	 * warning from the tracking itself) while still rejecting for the caller.
	 */
	track<T>(label: string, p: Promise<T>): Promise<T> {
		if (this.destroyed) return p;
		const id = this.nextId++;
		const entry: TrackedEntry = { label, created: this.now() };
		this.tracked.set(id, entry);
		p.then(
			() => this.settle(id, entry, "fulfilled"),
			() => this.settle(id, entry, "rejected"),
		);
		return p;
	}

	private settle(id: number, entry: TrackedEntry, state: "fulfilled" | "rejected"): void {
		// `destroyed` is checked here as well as in track(): a promise registered
		// before teardown can settle after it, and repopulating the ring at that
		// point would resurrect state the caller asked us to drop.
		if (this.destroyed || !this.tracked.delete(id)) return;
		this.completed.push({
			label: entry.label,
			created: entry.created,
			settledAt: this.now(),
			state,
		});
		if (this.completed.length > this.capacity) {
			this.completed.splice(0, this.completed.length - this.capacity);
		}
	}

	/** Work still outstanding, oldest first by insertion. */
	pending(): PendingEntry[] {
		const now = this.now();
		return [...this.tracked.values()].map((e) => ({
			label: e.label,
			ageMs: now - e.created,
		}));
	}

	recent(): CompletedEntry[] {
		return [...this.completed];
	}

	destroy(): void {
		this.destroyed = true;
		this.tracked.clear();
		this.completed.length = 0;
	}
}

let active: PromiseTracker | null = null;

/** Install the tracker the free-function helper routes to. Called from main.ts
 *  in dev builds; left null in production, where `trackPromise` is identity. */
export function setActiveTracker(tracker: PromiseTracker | null): void {
	active = tracker;
}

export function activeTracker(): PromiseTracker | null {
	return active;
}

/**
 * Track `p` if a tracker is installed, otherwise return it unchanged.
 *
 * The `DEV_MODE` guard is what makes this free to sprinkle on hot paths: in a
 * production bundle the whole body folds to `return p` and the tracker module
 * is tree-shaken out.
 */
export function trackPromise<T>(label: string, p: Promise<T>): Promise<T> {
	if (!DEV_MODE) return p;
	return active ? active.track(label, p) : p;
}

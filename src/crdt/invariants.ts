/**
 * Runtime invariant checking.
 *
 * Ported from Relay (`src/merge-hsm/invariants/`). The gap this closes: we
 * already DETECT broken sync state — `drift on X (editor 7 vs doc 6)` is a log
 * line we emit, silently repair, and move on from. That is an invariant
 * violation we tolerate instead of a contract we enforce, which is why the
 * live-bound baseline could rot for weeks before a delete turned it into a
 * user-visible artifact.
 *
 * Each invariant is NAMED, so a violation is reportable and greppable rather
 * than inferred from a symptom. All checks here are in-memory and cheap; the
 * signature is async-capable so a disk-reading invariant
 * (`synced-means-disk-matches-baseline`) can be added without redesign.
 */

export interface InvariantContext {
	/** note_ids tombstoned by removeDoc. */
	removedNoteIds: ReadonlySet<string>;
	/** note_ids with a resident Y.Doc in the registry. */
	residentNoteIds: ReadonlySet<string>;
	/** note_ids advertising syncStep1 (an OPEN room). */
	enrolledNoteIds: ReadonlySet<string>;
	/** Vault paths the live editor is currently bound to. */
	liveBoundPaths: ReadonlySet<string>;
	/** Every path currently carrying an id mapping. */
	mappedPaths: ReadonlySet<string>;
	pathForId(noteId: string): string | null;
	idForPath(path: string): string | null;
}

export interface InvariantViolation {
	id: string;
	description: string;
	detail: string;
}

export interface InvariantDefinition {
	id: string;
	description: string;
	/** Return a detail string when VIOLATED, or null when it holds. */
	check(ctx: InvariantContext): string | null | Promise<string | null>;
}

const list = (items: Iterable<string>, max = 5): string => {
	const all = [...items];
	const head = all.slice(0, max).join(", ");
	return all.length > max ? `${head} (+${all.length - max} more)` : head;
};

export const STANDARD_INVARIANTS: InvariantDefinition[] = [
	{
		id: "removed-implies-not-resident",
		description: "A tombstoned note must have no resident Y.Doc",
		check(ctx) {
			const bad = [...ctx.removedNoteIds].filter((id) => ctx.residentNoteIds.has(id));
			return bad.length ? `resident docs for removed note_ids: ${list(bad)}` : null;
		},
	},
	{
		id: "removed-implies-not-enrolled",
		description: "A tombstoned note must not hold an open room",
		check(ctx) {
			const bad = [...ctx.removedNoteIds].filter((id) => ctx.enrolledNoteIds.has(id));
			return bad.length ? `open rooms for removed note_ids: ${list(bad)}` : null;
		},
	},
	{
		id: "enrolled-implies-resident",
		description: "An enrolled note must have a resident doc to advertise",
		check(ctx) {
			const bad = [...ctx.enrolledNoteIds].filter((id) => !ctx.residentNoteIds.has(id));
			return bad.length ? `enrolled but not resident: ${list(bad)}` : null;
		},
	},
	{
		id: "live-bound-implies-mapped",
		description: "A live-bound path must resolve to a note_id",
		check(ctx) {
			const bad = [...ctx.liveBoundPaths].filter((p) => ctx.idForPath(p) === null);
			return bad.length ? `live-bound paths with no note_id: ${list(bad)}` : null;
		},
	},
	{
		id: "id-map-bijective",
		description: "path→id and id→path must agree in both directions",
		check(ctx) {
			const bad: string[] = [];
			for (const path of ctx.mappedPaths) {
				const id = ctx.idForPath(path);
				if (id === null) continue;
				if (ctx.pathForId(id) !== path) bad.push(`${path}→${id}→${ctx.pathForId(id)}`);
			}
			return bad.length ? `id-map direction mismatch: ${list(bad)}` : null;
		},
	},
];

export interface InvariantCheckerOpts {
	getContext: () => InvariantContext;
	onViolation: (violation: InvariantViolation) => void;
	invariants?: InvariantDefinition[];
	/** Timer injection so periodic checking is testable (see TimeProvider). */
	setInterval?: (cb: () => void, ms: number) => number;
	clearInterval?: (id: number) => void;
}

export class InvariantChecker {
	private timer: number | null = null;
	private readonly invariants: InvariantDefinition[];

	constructor(private readonly opts: InvariantCheckerOpts) {
		this.invariants = opts.invariants ?? STANDARD_INVARIANTS;
	}

	/** Run every invariant once. Returns the violations found (also reported via
	 *  onViolation). A throwing invariant is itself a violation — a check that
	 *  cannot evaluate is never evidence that the property holds. */
	async checkAll(): Promise<InvariantViolation[]> {
		const ctx = this.opts.getContext();
		const violations: InvariantViolation[] = [];
		for (const inv of this.invariants) {
			let detail: string | null;
			try {
				detail = await inv.check(ctx);
			} catch (e) {
				detail = `check threw: ${e instanceof Error ? e.message : String(e)}`;
			}
			if (detail !== null) {
				const violation = { id: inv.id, description: inv.description, detail };
				violations.push(violation);
				this.opts.onViolation(violation);
			}
		}
		return violations;
	}

	startPeriodicChecks(ms: number): void {
		if (this.timer !== null) return;
		const schedule = this.opts.setInterval ?? ((cb, delay) => window.setInterval(cb, delay));
		this.timer = schedule(() => void this.checkAll(), ms);
	}

	stop(): void {
		if (this.timer === null) return;
		const cancel = this.opts.clearInterval ?? ((id: number) => window.clearInterval(id));
		cancel(this.timer);
		this.timer = null;
	}
}

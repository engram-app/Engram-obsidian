/**
 * Typed feature flags with a schema.
 *
 * Ported from Relay (`src/flags.ts` + `src/flagManager.ts`). The valuable part
 * is not the booleans — we already have those in settings — it is that the
 * schema is a mapped type over `FeatureFlags`, so **adding a flag without
 * declaring its category, title and description is a type error**. That is what
 * stops a flag from shipping as an undocumented boolean nobody can find.
 *
 * Categories decide visibility, which is the second half of the idea:
 *   - `labs`      — opt-in user-facing behavior. Always shown.
 *   - `debugging` — diagnostic instrumentation. Shown only with diagnostics on.
 *   - `danger`    — changes persistence or sync semantics. Diagnostics-only, and
 *                   rendered in a marked zone. Must default OFF (asserted in
 *                   tests) — a danger flag that ships on is an un-reviewed
 *                   migration wearing a flag's clothes.
 *
 * ponytail: no singleton manager, no server-pushed overrides. Relay has both;
 * we have no backend flag endpoint to push from, and every consumer already
 * receives its options explicitly. Add a manager when a second reader needs the
 * flags without a path to thread them through.
 */

export type FlagCategory = "labs" | "debugging" | "danger";

export interface FlagSchemaEntry {
	default: boolean;
	category: FlagCategory;
	/** Row heading in settings. */
	title: string;
	/** One-line summary beside the toggle. */
	description: string;
}

/** Every supported flag. Adding a key here forces a `FLAG_SCHEMA` entry. */
export interface FeatureFlags {
	/** Capture an ordered timeline of CRDT sync events for replay (#356). */
	crdtRecording: boolean;
	/** Merge disk changes against the persisted LCA instead of diffing against
	 *  current doc state (#357). */
	crdtLcaMerge: boolean;
}

export const FLAG_SCHEMA: { [K in keyof FeatureFlags]: FlagSchemaEntry } = {
	crdtRecording: {
		default: false,
		category: "debugging",
		title: "Record CRDT sync timeline",
		description:
			"Capture an ordered event timeline for each synced note so a sync failure can be replayed offline. Metadata and note content stay local.",
	},
	crdtLcaMerge: {
		default: false,
		category: "danger",
		title: "Three-way merge against the last common ancestor",
		description:
			"Merge disk edits against the last synced content instead of the current document state. Changes how concurrent edits are resolved.",
	},
};

const FLAG_KEYS = Object.keys(FLAG_SCHEMA) as (keyof FeatureFlags)[];

/**
 * Resolve stored overrides against the schema defaults.
 *
 * Deliberately strict about what it accepts: `data.json` is a user-editable
 * file, so a hand-edited `"true"` must not enable a danger flag by truthiness,
 * and a key left behind by a retired flag must not survive into the result.
 */
export function resolveFlags(stored: Partial<FeatureFlags> | undefined): FeatureFlags {
	const out = {} as FeatureFlags;
	for (const key of FLAG_KEYS) {
		const value = stored?.[key];
		out[key] = typeof value === "boolean" ? value : FLAG_SCHEMA[key].default;
	}
	return out;
}

export type FlagEntry = [keyof FeatureFlags, FlagSchemaEntry];

/** Schema entries in declaration order, filtered to one category. */
export function flagsForCategory(category: FlagCategory): FlagEntry[] {
	return FLAG_KEYS.filter((key) => FLAG_SCHEMA[key].category === category).map((key) => [
		key,
		FLAG_SCHEMA[key],
	]);
}

/** Which flags the settings UI should draw. `labs` always; the rest only once
 *  the user has opted into diagnostics. */
export function visibleFlags(diagnosticsEnabled: boolean): FlagEntry[] {
	return FLAG_KEYS.filter(
		(key) => diagnosticsEnabled || FLAG_SCHEMA[key].category === "labs",
	).map((key) => [key, FLAG_SCHEMA[key]]);
}

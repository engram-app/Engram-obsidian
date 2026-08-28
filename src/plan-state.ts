export interface PlanState {
	tier: "free" | "starter" | "pro";
	attachmentsTextOnly: boolean;
	maxFileBytes: number;
	attachmentBytesCap: number | null;
	/** How many notes the plan indexes for search. null == uncapped. */
	indexedNotesCap: number | null;
	updatedAt: number;
}

/** Parse the wire `plan` map (snake_case from the backend) into PlanState.
 *  Returns null if the shape is missing/invalid (older backend). Tolerant:
 *  the backend may serialize the tier atom as a string. */
export function parsePlanState(raw: unknown, now: number): PlanState | null {
	if (typeof raw !== "object" || raw === null) return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.tier !== "string") return null;
	return {
		// Validate, don't cast: an unknown backend tier ("team", a typo) must
		// degrade to the most restrictive plan, not launder through the union.
		tier: r.tier === "starter" || r.tier === "pro" ? r.tier : "free",
		// MIGRATE step. The backend renamed this to the grant-shaped
		// `attachments_all_types` (true == allowed) because the old
		// restriction-shaped spelling inverted the meaning of "no limits" and
		// silently blocked attachments on self-hosted servers. Prefer the new
		// field; fall back to the legacy one so this build still works against
		// a backend older than the rename. Falls back to permissive when
		// NEITHER field is present, matching preGateAttachment's "unknown plan
		// → let the backend decide" direction.
		attachmentsTextOnly:
			typeof r.attachments_all_types === "boolean"
				? r.attachments_all_types === false
				: r.attachments_text_only === true,
		maxFileBytes: typeof r.max_file_bytes === "number" ? r.max_file_bytes : 0,
		attachmentBytesCap:
			typeof r.attachment_bytes_cap === "number" ? r.attachment_bytes_cap : null,
		// Absent on a backend older than the free keyword-only tier → treat as
		// uncapped, matching this file's "unknown plan → permissive" direction.
		// A negative value is the backend's "unlimited" sentinel, not a cap of -1.
		indexedNotesCap:
			typeof r.indexed_notes_cap === "number" && r.indexed_notes_cap >= 0
				? r.indexed_notes_cap
				: null,
		updatedAt: now,
	};
}

/** True when the transition unlocks non-text attachments (text-only true→false). */
export function attachmentCapabilityGained(prev: PlanState | null, next: PlanState): boolean {
	const was = prev?.attachmentsTextOnly ?? true;
	return was && !next.attachmentsTextOnly;
}

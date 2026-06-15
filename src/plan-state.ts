export interface PlanState {
	tier: "free" | "starter" | "pro";
	attachmentsTextOnly: boolean;
	maxFileBytes: number;
	attachmentBytesCap: number | null;
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
		tier: (r.tier as PlanState["tier"]) ?? "free",
		attachmentsTextOnly: r.attachments_text_only === true,
		maxFileBytes: typeof r.max_file_bytes === "number" ? r.max_file_bytes : 0,
		attachmentBytesCap:
			typeof r.attachment_bytes_cap === "number" ? r.attachment_bytes_cap : null,
		updatedAt: now,
	};
}

/** True when the transition unlocks non-text attachments (text-only true→false). */
export function attachmentCapabilityGained(prev: PlanState | null, next: PlanState): boolean {
	const was = prev?.attachmentsTextOnly ?? true;
	return was && !next.attachmentsTextOnly;
}

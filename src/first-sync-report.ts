import { rlog } from "./remote-log";
import type { SyncChoice, SyncPlan, SyncProgress } from "./types";

/** Body of `POST /api/analytics/sync-summary`. Counts, enums and a duration
 *  only: the type has no string slot a path, title or vault name could fill.
 *  The backend derives `outcome` from total/failed, so it is not sent. */
export type SyncSummaryPayload =
	| {
			phase: "planned";
			notes: number;
			attachments: number;
			folders: number;
			choice: "push" | "pull" | "merge";
			platform: "desktop" | "mobile";
	  }
	| {
			phase: "finished";
			total: number;
			failed: number;
			skipped: number;
			duration_ms: number;
			platform: "desktop" | "mobile";
	  };

function choiceKind(choice: SyncChoice): "push" | "pull" | "merge" {
	if (choice.startsWith("push-all")) return "push";
	if (choice.startsWith("pull-all")) return "pull";
	return "merge";
}

/** Reports one first sync to the backend: `planned` when the user's choice
 *  starts the run, `finished` when it settles. Each phase is sent at most once
 *  per instance. Fire-and-forget: a failed post is debug-logged and never
 *  reaches the sync. */
export class FirstSyncReporter {
	private startedAt: number | null = null;
	private plannedSent = false;
	private finishedSent = false;
	/** Latest tally per phase: `current` restarts each phase, so the run total
	 *  is the sum of every phase's last value. */
	private readonly phases = new Map<
		string,
		{ current: number; failed: number; skipped: number }
	>();

	constructor(
		private readonly post: (payload: SyncSummaryPayload) => Promise<void>,
		private readonly platform: "desktop" | "mobile",
		private readonly now: () => number = Date.now,
	) {}

	planned(choice: SyncChoice, plan: SyncPlan): void {
		if (this.plannedSent) return;
		this.plannedSent = true;
		this.startedAt = this.now();
		this.send({
			phase: "planned",
			// A path in both lists is one note, not two.
			notes: new Set([...plan.toPush.notes, ...plan.toPull.notes]).size,
			attachments: new Set([...plan.toPush.attachments, ...plan.toPull.attachments]).size,
			folders: Math.max(plan.localFolderCount, plan.serverFolderCount),
			choice: choiceKind(choice),
			platform: this.platform,
		});
	}

	/** Feed every engine progress event so a run that ends without a
	 *  "complete" event still reports the work done so far. */
	observe(p: SyncProgress): void {
		this.phases.set(p.phase, { current: p.current, failed: p.failed, skipped: p.skipped ?? 0 });
	}

	/** Report the run's tally from what `observe` saw. `aborted` (the sync threw
	 *  or never completed) counts as at least one failure so the outcome is
	 *  never "complete". The backend derives `partial` vs `failed` from counts. */
	finish(aborted: boolean): void {
		const t = { synced: 0, skipped: 0, failed: 0 };
		for (const v of this.phases.values()) {
			t.synced += v.current;
			t.skipped += v.skipped;
			t.failed += v.failed;
		}
		if (aborted && t.failed === 0) t.failed = 1;
		this.finished(t);
	}

	finished(tally: { synced: number; skipped: number; failed: number }): void {
		if (this.finishedSent) return;
		this.finishedSent = true;
		this.send({
			phase: "finished",
			total: tally.synced + tally.skipped + tally.failed,
			failed: tally.failed,
			skipped: tally.skipped,
			duration_ms: Math.max(0, this.now() - (this.startedAt ?? this.now())),
			platform: this.platform,
		});
	}

	private send(payload: SyncSummaryPayload): void {
		const failed = (e: unknown) =>
			rlog().info("analytics", `sync-summary not sent: ${String(e)}`);
		try {
			this.post(payload).catch(failed);
		} catch (e) {
			failed(e);
		}
	}
}

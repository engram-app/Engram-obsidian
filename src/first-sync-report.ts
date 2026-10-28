import { rlog } from "./remote-log";
import type { SyncChoice, SyncPlan } from "./types";

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
			notes: plan.toPush.notes.length + plan.toPull.notes.length,
			attachments: plan.toPush.attachments.length + plan.toPull.attachments.length,
			folders: Math.max(plan.localFolderCount, plan.serverFolderCount),
			choice: choiceKind(choice),
			platform: this.platform,
		});
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

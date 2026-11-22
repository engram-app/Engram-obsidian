import { formatAnomaly, type RemoteLogEntry, rlog } from "../../src/remote-log";

/** Hand each `anomaly` call, as its reporter decided it, to `onEntry`, before
 *  the logger's identical-line window (`LOG_LIMITS.repeatWindowMs`) can fold a
 *  repeat of the same message into one "x N more" line. For tests of a
 *  reporter's own caps and edge triggers, which that window would mask. */
export function recordAnomalies(onEntry: (entry: RemoteLogEntry) => void): void {
	rlog().anomaly = (category, code, counts, reason) => {
		onEntry({
			ts: "",
			level: "warn",
			category,
			message: formatAnomaly(code, counts, reason),
			forced: true,
		});
	};
}

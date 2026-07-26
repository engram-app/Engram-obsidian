// Diagnostic logger for the relay-viewplugin build. `ediag` is gated OFF by
// default (EDIAG_VERBOSE) so the console stays clean for a smoothness test — the
// per-keystroke provider breadcrumbs only matter when actively chasing a wedge.
// `ediagAlways` (build marker + hard-failure breadcrumbs + a concise per-open
// binding line) stays on: it is quiet in the happy path and only speaks on real
// events, which is what we still want surfaced. This branch never merges as-is;
// the scaffolding gets stripped when the work ports to PR #331.
const EDIAG_VERBOSE = false;

// Console output is the entire point of this diagnostic build (Todd copies the
// [EDIAG] lines back). Obsidian's guidelines ban console.log and the eslint config
// forbids disabling that rule, so lint:obsidian is expected to stay red on THIS
// FILE for the life of the diag branch — it is throwaway scaffolding stripped
// before the work merges to PR #331 (where the ViewPlugin uses rlog, not console).
// biome-ignore lint/suspicious/noConsole: diagnostic-only build, not for merge
const clog = (...args: unknown[]): void => console.log(...args);

/** Verbose per-keystroke/per-frame breadcrumb. No-op unless EDIAG_VERBOSE. */
export const ediag = (...args: unknown[]): void => {
	if (EDIAG_VERBOSE) clog(...args);
};

/** Always logs, regardless of EDIAG_VERBOSE. Reserved for low-frequency, high-value
 *  signal: the build marker, crash catchers, and per-note binding lifecycle. */
export const ediagAlways = (...args: unknown[]): void => clog(...args);

let hangDiagnosticsInstalled = false;

/** Install once: a global uncaught-error / unhandled-rejection catcher to reveal
 *  the exception that silently kills the CRDT async loop (the "everything goes
 *  quiet and nothing sends" freeze). These are silent until something actually
 *  throws, so they cost nothing in the happy path. The 5s heartbeat was dropped —
 *  it was pure console noise for a smoothness test. */
export function installHangDiagnostics(_snapshot: () => { docs: number; enrolled: number }): void {
	if (hangDiagnosticsInstalled || typeof window === "undefined") return;
	hangDiagnosticsInstalled = true;
	window.addEventListener("unhandledrejection", (e) => {
		const r: unknown = e.reason;
		const msg = r instanceof Error ? r.message : String(r);
		const stack = r instanceof Error ? r.stack : undefined;
		ediagAlways(`[EDIAG] UNHANDLED-REJECTION ${msg} :: ${stack ?? "(no stack)"}`);
	});
	window.addEventListener("error", (e) => {
		const stack = e.error instanceof Error ? e.error.stack : undefined;
		ediagAlways(
			`[EDIAG] WINDOW-ERROR ${e.message} @ ${e.filename}:${e.lineno} :: ${stack ?? ""}`,
		);
	});
}

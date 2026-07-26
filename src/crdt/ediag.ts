// Diagnostic-only console logger for the `diag/crdt-bind-console` build. This is
// INTENTIONAL console output at Default level (plain console.log survives the
// prod esbuild, unlike devLog which tree-shakes to a no-op and uses the hidden
// console.debug) so Todd can copy the exact keystroke path from the browser
// console. This branch is a diagnostic probe and NEVER merges.
// biome-ignore lint/suspicious/noConsole: diagnostic-only build, not for merge
export const ediag = (...args: unknown[]): void => console.log(...args);

let hangDiagnosticsInstalled = false;

/** Install once: a global uncaught-error / unhandled-rejection catcher (to reveal
 *  the exception that silently kills the CRDT async loop — the "everything goes
 *  quiet and nothing sends" freeze) plus a 5s heartbeat so we can tell whether the
 *  whole renderer froze (heartbeat stops) or only the CRDT path did (heartbeat
 *  keeps ticking while sends stop). Diagnostic-only; never merges. */
export function installHangDiagnostics(snapshot: () => { docs: number; enrolled: number }): void {
	if (hangDiagnosticsInstalled || typeof window === "undefined") return;
	hangDiagnosticsInstalled = true;
	window.addEventListener("unhandledrejection", (e) => {
		const r = (e as PromiseRejectionEvent).reason;
		ediag(`[EDIAG] UNHANDLED-REJECTION ${r?.message ?? r} :: ${r?.stack ?? "(no stack)"}`);
	});
	window.addEventListener("error", (e) => {
		const ev = e as ErrorEvent;
		ediag(
			`[EDIAG] WINDOW-ERROR ${ev.message} @ ${ev.filename}:${ev.lineno} :: ${ev.error?.stack ?? ""}`,
		);
	});
	let hb = 0;
	window.setInterval(() => {
		const s = snapshot();
		ediag(`[EDIAG] heartbeat #${++hb} docs=${s.docs} enrolled=${s.enrolled}`);
	}, 5000);
}

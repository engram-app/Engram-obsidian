/**
 * A base class that gives every subclass pre-tagged loggers.
 *
 * Ported from Relay (`src/debug.ts` `HasLogging`). The problem it solves in our
 * codebase is tag drift: today a log site is `rlog().info("channel", ...)`, so
 * the category is a string literal repeated at every call site. Rename the
 * concept and the tags rot silently — greps stop finding things, and Loki
 * queries keep matching a name that no longer exists.
 *
 * Here the tag is bound once (defaulting to the class name) and `setLoggers`
 * retags every subsequent line, so a per-note object can relabel itself on
 * rename and its logs follow.
 *
 * ponytail: a sink indirection instead of importing `rlog`/`devLog` directly.
 * Two reasons — this module stays dependency-free and therefore trivially
 * testable, and the plugin decides once (in main.ts) where lines go. Upgrade
 * path if a second destination is ever needed: make the sink a list.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogSink = (level: LogLevel, category: string, message: string) => void;

let sink: LogSink | null = null;

/** Install the process-wide destination for `HasLogging` output. Pass `null` to
 *  detach (tests, and plugin unload). */
export function setLogSink(next: LogSink | null): void {
	sink = next;
}

/** Render one argument for the flat string a log line carries. Objects are
 *  JSON so a structured value survives. An unserializable one (cyclic, a BigInt,
 *  a live Y.Doc) degrades to a NAMED marker rather than throwing at the log site
 *  — a logging call must never be the thing that breaks a sync path. The marker
 *  carries the constructor name because `[object Object]`, the default
 *  stringification, tells the reader nothing about what was dropped. */
function render(arg: unknown): string {
	if (typeof arg === "string") return arg;
	if (arg instanceof Error) return arg.message;
	if (arg === null || typeof arg !== "object") return String(arg);
	try {
		// JSON.stringify returns undefined for values with no JSON form; treat that
		// the same as a throw so the marker path is the single fallback.
		return JSON.stringify(arg) ?? `[unserializable ${arg.constructor?.name ?? "object"}]`;
	} catch {
		return `[unserializable ${arg.constructor?.name ?? "object"}]`;
	}
}

function emit(level: LogLevel, category: string, args: unknown[]): void {
	if (!sink) return;
	sink(level, category, args.map(render).join(" "));
}

export class HasLogging {
	private logContext: string;

	constructor(context?: string) {
		this.logContext = context ?? new.target.name;
	}

	/** Retag every subsequent line from this object. Call when the thing being
	 *  logged about changes identity — a note that was renamed, a folder that
	 *  moved. */
	protected setLoggers(context: string): void {
		this.logContext = context;
	}

	protected debug(...args: unknown[]): void {
		emit("debug", this.logContext, args);
	}

	protected log(...args: unknown[]): void {
		emit("info", this.logContext, args);
	}

	protected warn(...args: unknown[]): void {
		emit("warn", this.logContext, args);
	}

	protected error(...args: unknown[]): void {
		emit("error", this.logContext, args);
	}
}

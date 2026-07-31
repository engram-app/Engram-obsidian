import { describe, expect, test } from "bun:test";
import { HasLogging, setLogSink } from "../src/has-logging";

interface Line {
	level: string;
	category: string;
	message: string;
}

/** Install a capturing sink for the duration of `fn`, then restore. */
function capture(fn: (lines: Line[]) => void): void {
	const lines: Line[] = [];
	setLogSink((level, category, message) => lines.push({ level, category, message }));
	try {
		fn(lines);
	} finally {
		setLogSink(null);
	}
}

/** The loggers are `protected` — they exist for subclasses, not callers. This
 *  stand-in re-exposes them so the tests can drive them the way real code does. */
class Widget extends HasLogging {
	debug = (...args: unknown[]) => super.debug(...args);
	log = (...args: unknown[]) => super.log(...args);
	warn = (...args: unknown[]) => super.warn(...args);
	error = (...args: unknown[]) => super.error(...args);
	retag = (context: string) => super.setLoggers(context);
}

describe("HasLogging", () => {
	test("tags lines with the subclass name by default", () => {
		capture((lines) => {
			new Widget().log("hello");

			expect(lines).toEqual([{ level: "info", category: "Widget", message: "hello" }]);
		});
	});

	test("an explicit context overrides the class name", () => {
		capture((lines) => {
			new Widget("sync-engine").warn("careful");

			expect(lines[0]).toEqual({
				level: "warn",
				category: "sync-engine",
				message: "careful",
			});
		});
	});

	test("setLoggers retags subsequent lines — a renamed object relabels itself", () => {
		capture((lines) => {
			const w = new Widget("notes/a.md");
			w.log("before");
			w.retag("notes/b.md");
			w.log("after");

			expect(lines.map((l) => l.category)).toEqual(["notes/a.md", "notes/b.md"]);
		});
	});

	test("routes each level to the sink under its own name", () => {
		capture((lines) => {
			const w = new Widget("w");
			w.debug("d");
			w.log("l");
			w.warn("wa");
			w.error("e");

			expect(lines.map((l) => l.level)).toEqual(["debug", "info", "warn", "error"]);
		});
	});

	test("joins extra arguments into the message", () => {
		capture((lines) => {
			new Widget("w").log("applied", 3, "ops");

			expect(lines[0].message).toBe("applied 3 ops");
		});
	});

	test("serializes an object argument instead of emitting [object Object]", () => {
		capture((lines) => {
			new Widget("w").log("state", { seq: 7 });

			expect(lines[0].message).toBe('state {"seq":7}');
		});
	});

	test("survives an unserializable argument rather than throwing at a log site", () => {
		capture((lines) => {
			const cyclic: Record<string, unknown> = {};
			cyclic.self = cyclic;

			expect(() => new Widget("w").log("cyclic", cyclic)).not.toThrow();
			// Names what was dropped. `[object Object]` would tell the reader nothing.
			expect(lines[0].message).toBe("cyclic [unserializable Object]");
		});
	});

	test("is a no-op with no sink installed — logging must never throw", () => {
		expect(() => new Widget("w").error("boom")).not.toThrow();
	});
});

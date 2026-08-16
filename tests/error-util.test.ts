import { describe, expect, test } from "bun:test";
import { errMsg } from "../src/error-util";

describe("errMsg", () => {
	test("Error instance → its message", () => {
		expect(errMsg(new Error("boom"))).toBe("boom");
	});

	test("string → itself", () => {
		expect(errMsg("oops")).toBe("oops");
	});

	test("number → string form", () => {
		expect(errMsg(42)).toBe("42");
	});

	test("plain object → JSON", () => {
		expect(errMsg({ code: 500, msg: "server" })).toBe('{"code":500,"msg":"server"}');
	});

	test("null → string form", () => {
		expect(errMsg(null)).toBe("null");
	});

	test("undefined → 'undefined'", () => {
		expect(errMsg(undefined)).toBe("undefined");
	});

	test("circular object → falls back to String()", () => {
		const o: { self?: unknown } = {};
		o.self = o;
		expect(errMsg(o)).toBe("[object Object]");
	});

	test("subclass of Error preserves message", () => {
		class MyErr extends Error {}
		expect(errMsg(new MyErr("specific"))).toBe("specific");
	});
});

/**
 * The path must not survive errMsg.
 *
 * Obsidian's vault adapter surfaces raw Node errors, and their messages end in
 * the absolute path. `errMsg(e)` is interpolated beside `noteRef()` on ~40 log
 * lines, so before this scrub those lines shipped in clear the exact path the
 * ref existed to hide. Each test asserts the RAW message would have leaked
 * first — otherwise it proves only that some string lacks a folder name.
 */
describe("errMsg — the path does not survive", () => {
	const SECRET = "Medical/2026 biopsy results.md";

	test("a Node fs error keeps its code and loses its path", () => {
		const raw = `ENOENT: no such file or directory, open '/home/t/vault/${SECRET}'`;
		expect(raw).toContain("Medical"); // the leak, before the fix

		const out = errMsg(new Error(raw));

		expect(out).toBe("ENOENT: no such file or directory");
		expect(out).not.toContain("Medical");
		expect(out).not.toContain("biopsy");
	});

	// Two paths, an arrow between them — the rename shape.
	test("EEXIST loses both sides of a rename", () => {
		const out = errMsg(
			new Error(`EEXIST: file already exists, rename '/v/${SECRET}' -> '/v/Divorce/x.md'`),
		);

		expect(out).toBe("EEXIST: file already exists");
		expect(out).not.toContain("Medical");
		expect(out).not.toContain("Divorce");
	});

	// Not every carrier is a Node fs error. A quoted run holding a separator is
	// a path wherever it appears.
	test("a quoted path in an ordinary message is blanked", () => {
		const out = errMsg(new Error(`Failed to read '${SECRET}' during sync`));

		expect(out).toBe("Failed to read '<path>' during sync");
		expect(out).not.toContain("Medical");
	});

	// The scrub must not eat the diagnostic. A quoted word with no separator is
	// not a path, and blanking it would cost information for no privacy gain.
	test("quoted non-paths are left alone", () => {
		expect(errMsg(new Error(`unexpected token 'while' in frontmatter`))).toBe(
			"unexpected token 'while' in frontmatter",
		);
	});

	test("a message with no path is unchanged", () => {
		expect(errMsg(new Error("Request timed out"))).toBe("Request timed out");
	});

	// The non-Error carriers still route through the scrub — a rejected
	// requestUrl() hands back a plain object, and JSON.stringify would print the
	// path just as happily.
	test("a non-Error carrier is scrubbed too", () => {
		const out = errMsg({ message: `open '/home/t/vault/${SECRET}' failed` });

		expect(out).not.toContain("Medical");
		expect(out).toContain("<path>");
	});

	test("a bare string carrier is scrubbed", () => {
		expect(errMsg(`cannot stat '/v/${SECRET}'`)).not.toContain("Medical");
	});
});

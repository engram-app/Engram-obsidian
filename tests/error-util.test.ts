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

/**
 * `knownPath` — the mechanism that actually works.
 *
 * Every case here is one the deleted `BARE_PATH` heuristic got WRONG, either by
 * leaking it or by eating a diagnostic. Exact redaction is complete by
 * construction: it does not care about quoting, extension, or whether the
 * target is a file at all.
 */
describe("errMsg — exact redaction via knownPath", () => {
	// Ordinary Obsidian titles. Every one of these leaked through the previous
	// regex, because its character classes excluded the very punctuation that
	// note titles are full of.
	test.each([
		["an apostrophe", "Medical/Tom's notes.md"],
		["parentheses and an ampersand", "Medical/Q&A (2026).md"],
		["a comma", "Medical/Notes, 2026.md"],
		["a semicolon", "Medical/a;b.md"],
		["a colon", "Medical/re: chemo.md"],
		["square brackets", "Medical/[draft] plan.md"],
		["no extension", "Medical/untitled"],
		["a folder, no file", "Medical/"],
		["an extension we do not enumerate", "Medical/data.xyz"],
	])("%s", (_name, path) => {
		const raw = `failed to index ${path} after retry`;
		expect(raw).toContain("Medical"); // the leak, before redaction

		expect(errMsg(new Error(raw), path)).not.toContain("Medical");
	});

	test("a file-like is accepted, like noteRef", () => {
		expect(errMsg(new Error("boom Medical/x.md"), { path: "Medical/x.md" })).toBe(
			"boom <path>",
		);
	});

	// A rename names two paths and either can appear in the failure.
	test("both sides of a rename are redacted", () => {
		const out = errMsg(new Error("EXDEV: Medical/old.md -> Divorce 2026/new.md"), [
			"Medical/old.md",
			"Divorce 2026/new.md",
		]);

		expect(out).not.toContain("Medical");
		expect(out).not.toContain("Divorce");
	});

	// A path that is a prefix of another must not redact half the longer one.
	test("a prefix path does not strand the longer one's tail", () => {
		const out = errMsg(new Error("copy Medical/a.md to Medical/a.md.bak failed"), [
			"Medical/a.md",
			"Medical/a.md.bak",
		]);

		expect(out).toBe("copy <path> to <path> failed");
	});

	test("redaction reaches the human half of an fs error", () => {
		const out = errMsg(
			new Error("ENOENT: cannot copy Medical/a.md, open '/v/x'"),
			"Medical/a.md",
		);

		expect(out).toBe("ENOENT: cannot copy <path>");
	});

	// Same site, WITHOUT knownPath — which is what actually pins the quoted
	// scrub of the human half. The test above passes either way: exact
	// redaction runs before FS_ERROR, so it never exercises the branch it
	// appears to be about. Verified by reverting the fix and watching only this
	// one fail.
	test("the human half is scrubbed with no knownPath at all", () => {
		const raw = "ENOENT: cannot copy '/v/Medical/a.md', open '/v/x'";
		expect(raw).toContain("Medical");

		expect(errMsg(new Error(raw))).toBe("ENOENT: cannot copy '<path>'");
	});

	test("no knownPath behaves exactly as before", () => {
		expect(errMsg(new Error("Request timed out"))).toBe("Request timed out");
	});
});

/**
 * Diagnostics the previous heuristic destroyed.
 *
 * These are not hypothetical: review produced each one against `BARE_PATH`,
 * where a `/` early in the message merged with a vault extension later and
 * swallowed everything between. They are pinned because the temptation to
 * re-add an unquoted-path regex will recur.
 */
describe("errMsg — diagnostics survive", () => {
	test.each([
		["a route and its status", "POST /api/notes returned 500 for note.md"],
		[
			"a URL beside a note",
			"failed to load https://cdn.example.com/lib.js while saving Inbox/note.md",
		],
		["a stack frame", "boom at src/sync.ts:412 in flushToDisk"],
		["a mime type", "unexpected content-type application/json for note.md"],
	])("%s", (_name, raw) => {
		expect(errMsg(new Error(raw))).toBe(raw);
	});
});

/**
 * The quoted rule, which is the fallback when no `knownPath` is available.
 *
 * The apostrophe case is the reason this block exists: the previous interior
 * class excluded ALL THREE quote characters rather than just its own
 * delimiter, so a double-quoted path containing `'` could never match — and
 * apostrophes in note titles are entirely ordinary. The old tests missed it by
 * using apostrophe-free names.
 */
describe("errMsg — quoted paths, no knownPath", () => {
	test.each([
		["an apostrophe inside double quotes", `failed to read "Medical/Tom's notes.md"`],
		["an extension outside any list", "failed on '/vault/Medical/data.xyz'"],
		["no extension at all", "failed on '/vault/Medical/untitled'"],
		["a relative path", "cannot read 'Medical/notes'"],
		// Deliberately NOT an fs-shaped message. The previous version of this row
		// used `EEXIST: ..., mkdir '/vault/Medical'`, which FS_ERROR matched and
		// returned before the quoted rule ever ran — so it passed with the quoted
		// rule disabled entirely and proved nothing about it.
		["a folder with no file", "cannot create '/vault/Medical'"],
	])("%s", (_name, raw) => {
		expect(raw).toContain("Medical");
		expect(errMsg(new Error(raw))).not.toContain("Medical");
	});

	// A rejected requestUrl() hands back a plain object. Encoding it to JSON
	// first turned `"` into `\"`, whose backslash satisfied the separator test,
	// so the rule matched the wrong span and left the path behind.
	test("an object carrier with a message is not JSON-mangled", () => {
		const out = errMsg({ message: `mkdir "/v/Medical" failed` });

		expect(out).toBe("mkdir '<path>' failed");
		expect(out).not.toContain("Medical");
	});
});

/**
 * ReDoS regression.
 *
 * The deleted heuristic was roughly cubic: 6.4 KB of input took 57 SECONDS,
 * synchronously, on Obsidian's renderer thread. `errMsg` has ~87 call sites, so
 * that was a UI freeze reachable from any error carrying a base64 body or an
 * HTML error page. The bound is deliberately loose — it is catching a
 * complexity class, not measuring a machine.
 */
describe("errMsg — cannot be made to hang", () => {
	test.each([
		["separator-dense, 12 KB", "a/".repeat(6400)],
		["base64-like with slashes", "SGVsbG8vV29ybGQ+PDw/Pz8vLy8vYWJjZGVm".repeat(60)],
		["quote-dense", `"a/b" `.repeat(4000)],
		["72 KB", "x/".repeat(36000)],
	])("%s", (_name, input) => {
		const started = performance.now();
		errMsg(new Error(input));

		expect(performance.now() - started).toBeLessThan(500);
	});
});

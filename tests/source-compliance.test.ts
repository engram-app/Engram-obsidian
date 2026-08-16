/**
 * Compliance test: source-level Obsidian community rules.
 *
 * Mirrors a subset of `eslint-plugin-obsidianmd` rules at the *file-text* level
 * (regex / substring) so that:
 *   1. A misconfigured eslint.config.mts cannot silently disable them.
 *   2. They run in <100ms with `bun test`, not seconds with ESLint.
 *   3. The test suite documents the intent, with rule references.
 *
 * For semantic checks beyond text patterns we still rely on the ESLint rule;
 * these tests are belt-and-suspenders, not a replacement.
 *
 * Rules mirrored (ID = `obsidianmd/<rule>`):
 *   - sample-names                  → no MyPlugin/SampleModal/etc.
 *   - no-sample-code                → no `registerInterval(window.setInterval(...,'setInterval'))`
 *   - hardcoded-config-path         → no bare `.obsidian` path literal
 *   - commands/no-default-hotkey    → no `hotkeys:` key in addCommand
 *   - commands/no-command-in-command-id   → addCommand id/name without 'command'
 *   - commands/no-command-in-command-name
 *   - commands/no-plugin-id-in-command-id
 *   - commands/no-plugin-name-in-command-name
 *   - no-forbidden-elements         → no createElement('style' | 'link')
 *   - platform                      → no navigator.userAgent / .platform
 *   - regex-lookbehind              → no `(?<=` / `(?<!` in regex (mobile)
 *   - no-global-this                → no bare `global` / `globalThis`
 *
 * Plus Developer-policy + Guidelines text-level catches:
 *   - no `innerHTML`, `outerHTML`, `insertAdjacentHTML` (XSS surface)
 *   - no `var ` declarations
 *   - no `app` (bare global) — must use `this.app`
 *   - no plugin self-update mechanism keywords (defensive)
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const srcRoot = join(repoRoot, "src");
const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8")) as {
	id: string;
	name: string;
	isDesktopOnly: boolean;
};

type SourceFile = { path: string; rel: string; text: string; lines: string[] };

function walkTsFiles(root: string): SourceFile[] {
	const out: SourceFile[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const p = join(root, entry.name);
		if (entry.isDirectory()) out.push(...walkTsFiles(p));
		else if (entry.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) {
			const text = readFileSync(p, "utf8");
			out.push({ path: p, rel: relative(repoRoot, p), text, lines: text.split("\n") });
		}
	}
	return out;
}

const sources = walkTsFiles(srcRoot);

/** Strip line/block comments + string literals while preserving line boundaries. */
function stripCommentsAndStrings(text: string): string {
	const blankExceptNewlines = (m: string) => m.replace(/[^\n]/g, " ");
	return text
		.replace(/\/\*[\s\S]*?\*\//g, blankExceptNewlines)
		.replace(/(^|[^:\\])\/\/[^\n]*/g, "$1") // avoid eating "http://"
		.replace(/`(?:[^`\\]|\\.)*`/g, blankExceptNewlines)
		.replace(/"(?:[^"\\]|\\.)*"/g, '""')
		.replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

type Finding = { file: string; line: number; snippet: string };

function findInSources(
	predicate: (lineText: string, rawText: string) => boolean,
	files: SourceFile[] = sources,
): Finding[] {
	const findings: Finding[] = [];
	for (const f of files) {
		const stripped = stripCommentsAndStrings(f.text);
		const strippedLines = stripped.split("\n");
		for (let i = 0; i < strippedLines.length; i++) {
			if (predicate(strippedLines[i], f.text)) {
				findings.push({ file: f.rel, line: i + 1, snippet: f.lines[i]?.trim() ?? "" });
			}
		}
	}
	return findings;
}

describe("sample-names — no template class/interface names", () => {
	const SAMPLE_NAMES = ["MyPlugin", "MyPluginSettings", "SampleSettingTab", "SampleModal"];
	test.each(SAMPLE_NAMES)("no occurrence of '%s' as a declaration", (name) => {
		const re = new RegExp(`\\b(class|interface)\\s+${name}\\b`);
		const found = findInSources((line) => re.test(line));
		expect(found).toEqual([]);
	});

	test("no `mySetting` property name (sample-names rule)", () => {
		const found = findInSources((line) => /\bmySetting\s*[:?]/.test(line));
		expect(found).toEqual([]);
	});
});

describe("no-sample-code — template snippets removed", () => {
	test("no sample `registerInterval` template call", () => {
		// from eslint-plugin-obsidianmd template: window.setInterval with the literal 'setInterval' log
		const matches = sources.filter((f) =>
			/registerInterval\s*\(\s*window\.setInterval\s*\([^)]*console\.log\(\s*['"]setInterval['"]/.test(
				f.text,
			),
		);
		expect(matches.map((f) => f.rel)).toEqual([]);
	});

	test("no sample `registerDomEvent` template call", () => {
		const matches = sources.filter((f) =>
			/registerDomEvent\s*\(\s*document\s*,\s*['"]click['"][\s\S]*?console\.log\(\s*['"]click['"]/.test(
				f.text,
			),
		);
		expect(matches.map((f) => f.rel)).toEqual([]);
	});
});

describe("hardcoded-config-path — no bare `.obsidian` literal", () => {
	test("no string literal contains `.obsidian` as a path segment", () => {
		// Rule operates on Literal AST nodes; approximate by extracting
		// quoted string literals from each line (after comment-stripping)
		// and checking the upstream rule's regex against each literal.
		const findings: Finding[] = [];
		const re = /(?<![a-zA-Z0-9])\.obsidian(?![a-zA-Z0-9_-])/;
		// Match only "..." and '...' literals; backticks are stripped to spaces
		// by stripCommentsAndStrings to skip JSDoc/Markdown code spans.
		const literalRe = /(['"])(?:\\.|(?!\1).)*\1/g;
		for (const f of sources) {
			const strippedLines = stripCommentsAndStrings(f.text).split("\n");
			strippedLines.forEach((line, i) => {
				const literals = line.match(literalRe) ?? [];
				if (literals.some((l) => re.test(l))) {
					findings.push({ file: f.rel, line: i + 1, snippet: f.lines[i]?.trim() ?? "" });
				}
			});
		}
		expect(findings).toEqual([]);
	});
});

describe("commands/* — addCommand best practices", () => {
	// Parse every `this.addCommand({...})` block once.
	type Cmd = { file: string; line: number; body: string };
	const commandBlocks: Cmd[] = [];
	for (const f of sources) {
		const re = /this\.addCommand\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
		for (const m of f.text.matchAll(re)) {
			const upto = f.text.slice(0, m.index ?? 0);
			commandBlocks.push({
				file: f.rel,
				line: upto.split("\n").length,
				body: m[1],
			});
		}
	}

	const extractField = (body: string, key: string): string | undefined => {
		const m = body.match(new RegExp(`${key}\\s*:\\s*(['"\`])([^'"\`]*)\\1`));
		return m?.[2];
	};

	test("at least one addCommand exists (sanity)", () => {
		expect(commandBlocks.length).toBeGreaterThan(0);
	});

	test("no command id contains the word 'command'", () => {
		const offenders = commandBlocks.filter((c) =>
			extractField(c.body, "id")?.toLowerCase().includes("command"),
		);
		expect(offenders.map((c) => `${c.file}:${c.line}`)).toEqual([]);
	});

	test("no command name contains the word 'command'", () => {
		const offenders = commandBlocks.filter((c) =>
			extractField(c.body, "name")?.toLowerCase().includes("command"),
		);
		expect(offenders.map((c) => `${c.file}:${c.line}`)).toEqual([]);
	});

	test("no command id contains the plugin id", () => {
		const pid = manifest.id.toLowerCase();
		const offenders = commandBlocks.filter((c) =>
			extractField(c.body, "id")?.toLowerCase().includes(pid),
		);
		expect(offenders.map((c) => `${c.file}:${c.line}`)).toEqual([]);
	});

	test("no command name contains the plugin name", () => {
		const pname = manifest.name.toLowerCase();
		const offenders = commandBlocks.filter((c) =>
			extractField(c.body, "name")?.toLowerCase().includes(pname),
		);
		expect(offenders.map((c) => `${c.file}:${c.line}`)).toEqual([]);
	});

	test("no command sets default `hotkeys`", () => {
		const offenders = commandBlocks.filter((c) => /\bhotkeys\s*:/.test(c.body));
		expect(offenders.map((c) => `${c.file}:${c.line}`)).toEqual([]);
	});
});

describe("no-forbidden-elements — no createElement('style'|'link')", () => {
	test.each(["style", "link"])("no document.createElement('%s')", (tag) => {
		const found = findInSources((line) =>
			new RegExp(`document\\.createElement\\s*\\(\\s*['"\`]${tag}['"\`]`).test(line),
		);
		expect(found).toEqual([]);
	});

	test.each(["style", "link"])("no .createEl('%s', ...)", (tag) => {
		const found = findInSources((line) =>
			new RegExp(`\\.createEl\\s*\\(\\s*['"\`]${tag}['"\`]`).test(line),
		);
		expect(found).toEqual([]);
	});
});

describe("platform — no navigator.userAgent / .platform", () => {
	test.each(["userAgent", "platform"])("no navigator.%s access", (prop) => {
		const re = new RegExp(`(?:^|[^.\\w])(?:window\\.)?navigator\\.${prop}\\b`);
		const found = findInSources((line) => re.test(line));
		expect(found).toEqual([]);
	});
});

describe("regex-lookbehind — not allowed when isDesktopOnly=false", () => {
	test("no `(?<=` or `(?<!` regex pattern in source", () => {
		if (manifest.isDesktopOnly) return;
		const re = /\(\?<[=!]/;
		const found = findInSources((line) => re.test(line));
		expect(found).toEqual([]);
	});
});

describe("no-global-this — no bare `global` / `globalThis`", () => {
	test("no top-level `globalThis.` or `global.` reference", () => {
		// member expressions like `foo.globalThis` are OK; bare ones are not.
		const found = findInSources((line) =>
			/(?:^|[^.\w])(globalThis|global)\.[A-Za-z_]/.test(line),
		);
		expect(found).toEqual([]);
	});
});

describe("Developer policy — no innerHTML / outerHTML / insertAdjacentHTML", () => {
	test.each(["innerHTML", "outerHTML", "insertAdjacentHTML"])(
		"no `.%s` assignment / call",
		(api) => {
			const re = new RegExp(`\\.${api}\\b`);
			const found = findInSources((line) => re.test(line));
			expect(found).toEqual([]);
		},
	);
});

describe("Plugin guidelines — no `var ` declarations", () => {
	test("no `var ` keyword in src/*.ts", () => {
		const found = findInSources((line) => /(^|[\s;{])var\s+[A-Za-z_]/.test(line));
		expect(found).toEqual([]);
	});
});

describe("Plugin guidelines — no plugin self-update mechanism", () => {
	test("no obvious self-update keywords", () => {
		// Defensive: catches "checkForUpdate", "selfUpdate", "downloadPlugin" etc.
		const re = /\b(selfUpdate|checkForUpdate|autoUpdatePlugin|downloadPlugin)\b/;
		const found = findInSources((line) => re.test(line));
		expect(found).toEqual([]);
	});
});

describe("Plugin guidelines — never use the global `app` object", () => {
	test("no `window.app` reference", () => {
		// https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Avoid+the+global+%60app%60+object
		// The guideline specifically forbids the GLOBAL `app` (and `window.app`).
		// Function parameters named `app` are fine (used by helper utilities).
		const found = findInSources((line) => /\bwindow\.app\b/.test(line));
		expect(found).toEqual([]);
	});
});

/**
 * Privacy invariant: nothing in the plugin may retain note content for export.
 *
 * A CRDT wire frame or Yjs update is NOT opaque — the note body is recoverable
 * from it, base64 or not. The sync recorder stored whole inbound frames in a
 * 5,000-entry buffer that `__engramDebug.timeline()` serialized to a string a
 * user could paste into a public issue. It was removed for that reason.
 *
 * These are text-level guards, so they cannot catch every reintroduction — but
 * they catch the shapes that actually occurred, and a deliberate new capture
 * has to edit this file, which is the point.
 */
describe("privacy — no content retention for export", () => {
	// Matched on the IDENTIFIER, not the module string. findInSources runs its
	// predicate against stripCommentsAndStrings(), which blanks every string
	// literal — so a regex looking for `from "../sync-recorder"` was testing
	// `from ""` and could never fail. It passed against the pre-removal source,
	// which is the definition of a guard that does not guard.
	test("the sync recorder stays deleted", () => {
		const found = findInSources((line) => /\bSyncRecorder\b|\bserializeTimeline\b/.test(line));
		expect(found).toEqual([]);
	});

	// The content escape hatch on the debug snapshot. Nothing else stops it
	// coming back, and its whole failure mode is that it looks harmless.
	test("the debug snapshot has no content opt-in", () => {
		const found = findInSources((line) => /\bincludeContent\b|\bSnapshotOpts\b/.test(line));
		expect(found).toEqual([]);
	});

	// The offending shape: a whole frame or update handed to a buffer. Sibling
	// seams recorded a length or a hash and were fine; this is the one that
	// carried the body.
	test("no frame or update is stashed in a payload object", () => {
		// Two shapes, because this codebase writes both: an explicit
		// `{ frame: frameB64 }` and the shorthand `{ frameB64 }` / `{ b64 }`
		// it prefers elsewhere (channel.ts sends `{ doc_id: docId, b64 }`).
		// A guard that only knew the explicit form would have missed the
		// shorthand rewrite of the very line it was written for.
		const explicit =
			/\b(frame|frameB64|update|content|text|body)\s*:\s*(frameB64|frame|update|b64)\b/;
		// Anywhere in the literal, not just first: the realistic reintroduction
		// is `this.buf.push({ ts, noteId, b64 })`, and a first-property-only
		// regex missed that — along with `{ doc_id: docId, b64 }`, the exact
		// line this rule's comment cites.
		const shorthand = /\{[^}]*\b(frameB64|b64)\s*[,}]/;
		// ...which means the legitimate wire send now matches. Handing a frame
		// to the transport is what the transport is FOR; the rule is about
		// stashing one somewhere it can be read back later.
		const wireSend = /\.send\s*\(/;
		const found = findInSources(
			(line) => (explicit.test(line) || shorthand.test(line)) && !wireSend.test(line),
		);
		expect(found).toEqual([]);
	});

	// `record(...)` was the recorder's entry point. If a timeline ever comes
	// back, it comes back through a review that reads this test.
	test("no recorder-style record() calls survive", () => {
		const found = findInSources((line) => /recorder\??\.\s*record\s*\(/.test(line));
		expect(found).toEqual([]);
	});

	// `anomaly()` is the ONE rlog path that ships with diagnostics OFF (it
	// passes force=true, bypassing both `enabled` and the level threshold).
	// Every other rlog call is gated behind a setting the user opted into, so
	// paths travelling through those are consented telemetry. Anomaly lines
	// are not consented, and remote-log.ts states the contract in a comment:
	// "counts and reasons ONLY. Never a path, a title, or note content."
	// A comment is not a control. This is.
	//
	// Only INTERPOLATED expressions are inspected, never the literal prose:
	// the existing call site legitimately reads "replay produced no files:",
	// and a guard that matched author-written words would fire on that and
	// get deleted. Runtime values are the thing that can carry user data.
	test("anomaly() interpolates no path, title, or content", () => {
		// Naive paren matching — it does not know about parens inside string
		// literals, so an unbalanced one captures MORE text than the call.
		// That errs toward flagging, which is the safe direction for a guard.
		const calls: Finding[] = [];
		for (const f of sources) {
			for (const m of f.text.matchAll(/\.anomaly\s*\(/g)) {
				const start = (m.index ?? 0) + m[0].length;
				let depth = 1;
				let i = start;
				for (; i < f.text.length && depth > 0; i++) {
					if (f.text[i] === "(") depth++;
					else if (f.text[i] === ")") depth--;
				}
				const args = f.text.slice(start, i - 1);
				const line = f.text.slice(0, m.index).split("\n").length;
				for (const expr of args.match(/\$\{[^}]*\}/g) ?? []) {
					if (/\b(path|file|title|content|name|query|folder|text|body)\b/i.test(expr)) {
						calls.push({ file: f.rel, line, snippet: expr });
					}
				}
			}
		}
		expect(calls).toEqual([]);
	});

	// If anomaly() ever loses its call sites the guard above passes vacuously,
	// exactly like the sync-recorder test did before it was fixed.
	test("anomaly() still has call sites for the guard to inspect", () => {
		const sites = sources.flatMap((f) => f.text.match(/\.anomaly\s*\(/g) ?? []);
		expect(sites.length).toBeGreaterThan(0);
	});
});

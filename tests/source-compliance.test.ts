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
	//
	// WHAT THIS CATCHES — an object or array literal, on ONE line or across
	// several, holding `b64` / `frameB64` / a `frame:`-style key, anywhere
	// except the single real wire send.
	//
	// WHAT IT DOES NOT — and this list is the point of writing it down, because
	// a text guard whose comment overstates its reach is worse than no guard:
	// the next reviewer trusts it.
	//   * an ALIAS: `const payload = b64; buf.push({ ts, payload })`
	//   * two statements: `const r = {}; r.b64 = b64; buf.push(r)`
	//   * a stash nested INSIDE the exempt wire send's payload
	//   * string building: `this.log += docId + ":" + b64`
	// Catching those needs dataflow, not regex. The runtime seam
	// (`redactPathLike` in remote-log.ts) is where enforcement that cannot be
	// evaded by rewriting belongs; this guard is the cheap first net.
	test("no frame or update is stashed in a payload object", () => {
		// Token-level, not literal-level. `[^{}]*` cannot cross a nested brace,
		// so `{ ts, meta: {}, b64 }` and `[Date.now(), ids[0], b64]` both walked
		// past the previous version. Matching `b64` in shorthand POSITION —
		// preceded by `{`, `,` or `[`, followed by `,`, `}` or `]` — needs no
		// span at all, so nesting cannot defeat it.
		// One level of nesting allowed inside the literal — `[^{}]*` alone could
		// not cross `{ ts, meta: {}, b64 }` or `[Date.now(), ids[0], b64]`, which
		// are ordinary shapes, not contrived ones.
		//
		// ONE level, not "all of them". This is a hand-rolled depth-1 matcher, so
		// `{ ts, m: { a: { b: 1 } }, b64 }` is NOT caught, and neither are a
		// spread (`{ ...{ b64 } }`), a getter, or a nested subscript
		// (`[a[b[0]], b64]`). Raising the constant does not close the class; only
		// a parser would. Stated plainly because the previous version of this
		// comment claimed the bypass set was closed when it had merely grown by
		// one — and a guard trusted beyond its reach is worse than none.
		//
		// Still anchored on literal POSITION (`[([=:,]` before the brace). A bare
		// token match like `, b64,` cannot tell an object literal from a call
		// argument, and flagged `this.onNoteYjsUpdate?.(noteId, b64, head, seq)`.
		// A guard that cries wolf gets deleted.
		const shapes = [
			/\b(frame|frameB64|update|content|text|body)\s*:\s*(frameB64|frame|update|b64)\b/g,
			/[([=:,]\s*\{(?:[^{}]|\{[^{}]*\})*?\b(frameB64|b64)\s*[,}]/g,
			/[([=:,]\s*\[(?:[^[\]]|\[[^[\]]*\])*?\b(frameB64|b64)\s*[,\]]/g,
		];
		// The one legitimate wire send, matched as a WHOLE STATEMENT rather than
		// by an anchor within it. A statement-scoped `wireSend.test(...)` let a
		// stash hide inside the exempt call:
		//
		//   this.send([this.crdtJoinRef, t, "crdt_msg",
		//             { doc_id: docId, b64: this.record({ b64 }) }]);
		//
		// Requiring the entire statement to equal the known-good form means any
		// wrapper, extra argument or reordering stops matching and is caught.
		const wireStatement =
			/^this\.send\(\[this\.crdtJoinRef,[^{}]*\{\s*doc_id:\s*docId,\s*b64\s*\}\]\);$/;

		const findings: Finding[] = [];
		for (const f of sources) {
			const stripped = stripCommentsAndStrings(f.text);
			for (const shape of shapes) {
				shape.lastIndex = 0;
				let m: RegExpExecArray | null = shape.exec(stripped);
				while (m !== null) {
					const from = stripped.lastIndexOf(";", m.index) + 1;
					const to = stripped.indexOf(";", shape.lastIndex - 1);
					// Leading `}` / `{` from the enclosing block survive the slice
					// (the previous statement's `;` is further back than the
					// block close), and they broke the `^` anchor — so the
					// exemption never matched and the real wire send was flagged.
					const statement = stripped
						.slice(from, to === -1 ? undefined : to + 1)
						.replace(/\s+/g, "")
						.replace(/^[^A-Za-z_$]*/, "");
					if (!wireStatement.test(statement)) {
						findings.push({
							file: f.rel,
							line: stripped.slice(0, m.index).split("\n").length,
							snippet: m[0].replace(/\s+/g, " ").trim(),
						});
					}
					m = shape.exec(stripped);
				}
			}
		}
		expect(findings).toEqual([]);
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
	// `anomaly(category, code, counts)` carries no free text: `counts` holds
	// numbers and booleans, and BOTH strings are slug-validated at runtime, so a
	// path is not expressible in any argument. That is the enforcement. This
	// guard exists so the codes stay greppable — a computed argument becomes
	// `invalid_code` / `invalid_category` at runtime, which is a dead telemetry
	// line rather than a disclosure, but a dead line is still a bug.
	//
	// Anchored on `.anomaly(` and reading BOTH string arguments. The previous
	// version anchored on a literal FIRST argument (`/\.anomaly\(\s*"[a-z]+"/`),
	// which meant a call site with a computed category — the leaking shape —
	// simply did not match and was never inspected. It reported healthy while
	// blind, and its anti-vacuity count was satisfied by the two well-formed
	// call sites.
	test("anomaly() is called with literal slug category and code", () => {
		const findings: Finding[] = [];
		let inspected = 0;

		for (const f of sources) {
			for (const m of f.text.matchAll(/\.anomaly\(([^)]*)/g)) {
				inspected += 1;
				const args = (m[1] ?? "").split(",");
				const line = f.text.slice(0, m.index).split("\n").length;
				for (const [i, label] of [
					[0, "category"],
					[1, "code"],
				] as const) {
					const arg = (args[i] ?? "").trim();
					if (!/^"[a-z0-9_]+"$/.test(arg)) {
						findings.push({
							file: f.rel,
							line,
							snippet: `${label}: ${arg || "(missing)"}`,
						});
					}
				}
			}
		}

		// Vacuity: a guard over zero call sites proves nothing, and this file
		// has shipped exactly that before.
		expect(inspected).toBeGreaterThan(0);
		expect(findings).toEqual([]);
	});
});

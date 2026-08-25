/**
 * #476 — the note-doubling class, closed at its source.
 *
 * A create used to be acked with ONE bit, `seeded: boolean`. That bit reported
 * `false` for two server states that demand OPPOSITE client actions:
 *
 *   "I stored nothing, the row is empty"      -> the client MUST push the body
 *   "I declined, the row holds another body"  -> the client must NOT push
 *
 * In the second case the client pushed anyway, into a Y.Doc it still believed
 * was empty. Writing a body into an empty doc mints a fresh clientID, so that
 * push was a RIVAL lineage carrying identical text, and YATA's contract is to
 * preserve both concurrent inserts rather than deduplicate them. The union is
 * the note, twice — and the next import reads the doubled file and doubles it
 * again. Measured across eight real 423-item imports: 3 MB grew to 120 MB, one
 * 34 KB note reaching 4.9 MB with its 225 distinct lines repeated 144 times.
 *
 * No client-side guard could fix that, which is the point worth remembering:
 * the invariant "a body reaches the server exactly once per create" was written
 * correctly and STILL doubled 13 notes, because it was evaluated against an
 * input that could not express the difference. The fix is the wire format —
 * the server now names the outcome (`stored` / `absent` / `occupied`) it
 * already computed and used to throw away.
 *
 * These tests pin the decision table directly, since it is the thing that must
 * never regress.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

type AnyEngine = Record<string, any>;

const SERVER_BODY = "the body the server already holds";
const LOCAL_BODY = "the body sitting on local disk";

/**
 * @param hasHistory whether the local doc already carries a lineage. With
 *        history, transmitting is always safe (`lca` diffs against it), so the
 *        outcome only matters when this is false — the empty-doc case.
 */
function makeEngine(opts: { hasHistory?: boolean; docState?: unknown } = {}) {
	const calls = {
		applyLocalEdit: [] as string[],
		applyRemoteUpdate: 0,
		docState: 0,
		/** Call ORDER — adopt-before-diff is the invariant, and a set of counts
		 *  cannot express it. */
		order: [] as string[],
	};

	const engine = new SyncEngine(
		{
			vault: { cachedRead: mock().mockResolvedValue(LOCAL_BODY) },
		} as any,
		{} as any,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	) as unknown as AnyEngine;

	engine.crdt = {
		hasAnyHistory: async () => opts.hasHistory === true,
		// The ONLY transmit path. If this fires on an `occupied` outcome, the
		// doubling is back.
		applyLocalEdit: async (_id: string, text: string) => {
			calls.applyLocalEdit.push(text);
			calls.order.push("applyLocalEdit");
			return text;
		},
		applyRemoteUpdate: async () => {
			calls.applyRemoteUpdate++;
			calls.order.push("applyRemoteUpdate");
		},
		projectedText: async () => SERVER_BODY,
		isCrdtEligible: () => true,
	};

	engine.crdtDocState =
		opts.docState === undefined
			? async () => {
					calls.docState++;
					return { b64: "" };
				}
			: opts.docState;

	return { engine, calls };
}

function seed(engine: AnyEngine, genesisOutcome: unknown) {
	return engine.seedBodyAfterCreate({
		effectiveId: "note-1",
		normalized: "Notes/a.md",
		file: { path: "Notes/a.md" },
		seeded: genesisOutcome === "stored",
		sameId: true,
		genesisUpdate: undefined,
		genesisContent: undefined,
		genesisOutcome,
	});
}

describe("genesis outcome decides whether a body may be transmitted (#476)", () => {
	test("occupied: adopts the server's lineage FIRST, then transmits as a diff", async () => {
		// Adopting is the PRECONDITION for transmitting safely, not a substitute
		// for it. An earlier revision returned the adopted text and stopped,
		// which silently discarded the local body: `occupied` means the server
		// holds a DIFFERENT body, so stopping means ours never arrives and the
		// server's text gets stamped as the baseline over it.
		const { engine, calls } = makeEngine();

		await seed(engine, "occupied");

		// Both halves, and the ORDER is the point: acquire identity, then diff
		// onto it. Reversed, the push is a rival lineage — that is #476.
		expect(calls.applyRemoteUpdate).toBe(1);
		expect(calls.applyLocalEdit).toEqual([LOCAL_BODY]);
		expect(calls.order).toEqual(["applyRemoteUpdate", "applyLocalEdit"]);
	});

	test("occupied: adopt FAILING transmits nothing — the server said it holds a body", async () => {
		// Deferring costs a slow convergence. Pushing costs a corrupted note.
		// Only one of those is recoverable, and here the server ASSERTED it holds
		// content, so we are not guessing.
		const { engine, calls } = makeEngine({
			docState: async () => {
				throw new Error("rate limited");
			},
		});

		const consumed = await seed(engine, "occupied");

		expect(calls.applyLocalEdit).toEqual([]);
		expect(consumed).toBeNull();
	});

	test("absent: transmits, because nothing else will ever fill the note", async () => {
		const { engine, calls } = makeEngine();

		await seed(engine, "absent");

		expect(calls.applyLocalEdit).toEqual([LOCAL_BODY]);
		// Trusted outright — no confirmation round trip on the common path.
		expect(calls.docState).toBe(0);
	});

	test("a doc that already has history transmits regardless of outcome", async () => {
		// `applyLocalEdit`'s `lca` diffs against the existing lineage instead of
		// minting a second one, so there is nothing to protect against here — and
		// refusing would strand a real local edit.
		const { engine, calls } = makeEngine({ hasHistory: true });

		await seed(engine, "occupied");

		expect(calls.applyLocalEdit).toEqual([LOCAL_BODY]);
	});
});

describe("an older backend that sends no outcome is confirmed, not guessed", () => {
	test("null outcome + adoptable server: adopts, then diffs onto that lineage", async () => {
		// A null outcome means an older backend. Where the room-free read still
		// answers, we can acquire the lineage and the push is a safe diff.
		const { engine, calls } = makeEngine();

		await seed(engine, null);

		expect(calls.docState).toBe(1);
		expect(calls.order).toEqual(["applyRemoteUpdate", "applyLocalEdit"]);
	});

	test("null outcome + unverifiable server: transmits anyway, and says why", async () => {
		// THE asymmetry with `occupied`. A backend predating `genesis` also
		// predates `crdt_doc_state` — they ship together — so a null outcome
		// guarantees the read is unavailable and we can never verify. Deferring
		// here is NOT the safe pole: nothing else fills this note, so it stays
		// blank on every device forever. A possible double beats a certain blank.
		const { engine, calls } = makeEngine({ docState: null });

		await seed(engine, null);

		expect(calls.applyLocalEdit).toEqual([LOCAL_BODY]);
	});

	test("null outcome + server genuinely empty: falls through and transmits", async () => {
		const { engine, calls } = makeEngine();
		engine.crdt.projectedText = async () => "";

		await seed(engine, null);

		expect(calls.docState).toBe(1);
		expect(calls.applyLocalEdit).toEqual([LOCAL_BODY]);
	});

	test("a server that never ANSWERS the read is latched off after one timeout", async () => {
		// An older backend does not reject `crdt_doc_state` — it does not reply at
		// all, so every probe costs a full sendRequest timeout. Unlatched, a bulk
		// import pays that on every create and sync effectively stops: the e2e
		// suite measured creates going from ~1.5s to ~2min each, which is how
		// this regression was caught before it reached anyone.
		let attempts = 0;
		const { engine, calls } = makeEngine({
			docState: async () => {
				attempts++;
				throw new Error("sendRequest timeout: crdt_doc_state");
			},
		});

		await seed(engine, null);
		await seed(engine, null);
		await seed(engine, null);

		expect(attempts).toBe(1);
		// ...and every create still delivers its body, just without the probe.
		expect(calls.applyLocalEdit).toEqual([LOCAL_BODY, LOCAL_BODY, LOCAL_BODY]);
	});

	test("a structured REJECT is a real answer and must not latch", async () => {
		// Rate limits and auth errors mean the server implements the frame and
		// declined this call. Latching on those would silently disable the
		// doubling protection on a healthy backend for the rest of the session.
		let attempts = 0;
		const { engine } = makeEngine({
			docState: async () => {
				attempts++;
				throw new Error('request failed: {"reason":"rate_limited"}');
			},
		});

		await seed(engine, null);
		await seed(engine, null);

		expect(attempts).toBe(2);
	});

	test("null outcome + no room-free read at all: still transmits", async () => {
		// Against a backend with NEITHER the outcome field nor `crdt_doc_state`,
		// refusing to push would leave every note permanently blank. That is a
		// worse, and silent, failure than the doubling it would avoid.
		const { engine, calls } = makeEngine({ docState: null });

		await seed(engine, null);

		expect(calls.applyLocalEdit).toEqual([LOCAL_BODY]);
	});
});

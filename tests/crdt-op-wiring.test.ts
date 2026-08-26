/**
 * Wiring tests for the durable CRDT op queue (create/delete):
 *  - the `makeCrdtOpSend` dispatch + error taxonomy (ok / retryable / terminal),
 *  - the queue integration: an op issued while NOT joined is HELD, flushed on
 *    join, removed on server ok; a terminal reply removes-and-surfaces (no
 *    infinite retry); persistence load restores a pending create/delete.
 *
 * Uses a fake channel whose acked calls resolve/reject scripted outcomes. no
 * real socket, deterministic under the injected clock.
 */
import { describe, expect, mock, test } from "bun:test";
import { type CrdtOpChannel, crdtOpFailureReason, makeCrdtOpSend } from "../src/crdt-op-dispatch";
import { type CrdtOp, CrdtOpQueue, type DropReason } from "../src/crdt-op-queue";

/** A sendRequest-style rejection carrying a structured server reason. */
function serverError(reason: string): Error {
	return new Error(`request failed: ${JSON.stringify({ reason })}`);
}

function op(kind: "create" | "delete", docId: string, path = `${docId}.md`): CrdtOp {
	return { id: `op-${docId}`, kind, docId, payload: { path }, enqueuedAt: 0, attempts: 0 };
}

describe("crdtOpFailureReason", () => {
	test("extracts the server reason from a sendRequest rejection", () => {
		expect(crdtOpFailureReason(serverError("id_conflict"))).toBe("id_conflict");
	});
	test("returns null for a non-structured error (timeout / not joined)", () => {
		expect(crdtOpFailureReason(new Error("sendRequest timeout: crdt_create"))).toBeNull();
		expect(crdtOpFailureReason(new Error("channel disconnected"))).toBeNull();
	});
});

describe("makeCrdtOpSend dispatch + taxonomy", () => {
	function fakeChannel(overrides: Partial<CrdtOpChannel> = {}): CrdtOpChannel {
		return {
			crdtCreate: mock(async (docId: string) => ({
				docId,
				seeded: false,
				genesisOutcome: "absent" as const,
			})),
			crdtDeleteAcked: mock(async (docId: string) => ({ doc_id: docId })),
			...overrides,
		};
	}

	test("create resolve → ok, and onCreated gets the server's id", async () => {
		const onCreated = mock(() => {});
		const send = makeCrdtOpSend({
			channel: () =>
				fakeChannel({
					crdtCreate: async () => ({
						docId: "server-id",
						seeded: false,
						genesisOutcome: "absent" as const,
					}),
				}),
			onCreated,
			onTerminal: () => {},
		});
		await expect(send(op("create", "local-id", "N.md"))).resolves.toBe("ok");
		// #1409: onCreated also carries seeded + the (here-unwired) genesis frame.
		// #476: and the server's genesis OUTCOME, which is what actually decides
		// whether the body may be transmitted — `seeded` alone could not.
		expect(onCreated).toHaveBeenCalledWith(
			"local-id",
			"server-id",
			"N.md",
			false,
			undefined,
			"absent",
		);
	});

	// H4 (adversarial review): a replayed create must still carry the genesis
	// body, or every note that ever failed its FIRST create attempt (rate
	// limit, offline, pre-join) opens a room on delivery — the exact case
	// #1409 exists to avoid. Proves buildGenesisFrame's return value reaches
	// BOTH crdtCreate's b64 argument and onCreated's genesis argument.
	test("H4: buildGenesisFrame's frame is sent as b64 and forwarded to onCreated", async () => {
		const crdtCreate = mock(async (_docId: string, _path: string, b64?: string) => ({
			docId: "server-id",
			seeded: b64 !== undefined,
			genesisOutcome: b64 === undefined ? ("absent" as const) : ("stored" as const),
		}));
		const onCreated = mock(() => {});
		const genesis = {
			b64: "BASE64FRAME",
			update: new Uint8Array([1, 2, 3]),
			content: "note body",
		};
		const send = makeCrdtOpSend({
			channel: () => fakeChannel({ crdtCreate }),
			buildGenesisFrame: async () => genesis,
			onCreated,
			onTerminal: () => {},
		});

		await expect(send(op("create", "local-id", "N.md"))).resolves.toBe("ok");

		expect(crdtCreate).toHaveBeenCalledWith("local-id", "N.md", "BASE64FRAME");
		expect(onCreated).toHaveBeenCalledWith(
			"local-id",
			"server-id",
			"N.md",
			true,
			genesis,
			"stored",
		);
	});

	test("H4: a note that doesn't qualify (buildGenesisFrame returns undefined) sends a bodyless create as before", async () => {
		const crdtCreate = mock(async (docId: string, _path: string, b64?: string) => ({
			docId,
			seeded: b64 !== undefined,
			genesisOutcome: b64 === undefined ? ("absent" as const) : ("stored" as const),
		}));
		const onCreated = mock(() => {});
		const send = makeCrdtOpSend({
			channel: () => fakeChannel({ crdtCreate }),
			buildGenesisFrame: async () => undefined,
			onCreated,
			onTerminal: () => {},
		});

		await expect(send(op("create", "local-id", "N.md"))).resolves.toBe("ok");

		expect(crdtCreate).toHaveBeenCalledWith("local-id", "N.md");
		// No frame was sent, so the server has nothing to hold: `absent` is what
		// permits the caller to transmit the body (#476).
		expect(onCreated).toHaveBeenCalledWith(
			"local-id",
			"local-id",
			"N.md",
			false,
			undefined,
			"absent",
		);
	});

	test("delete resolve → ok", async () => {
		const send = makeCrdtOpSend({
			channel: () => fakeChannel(),
			onCreated: () => {},
			onTerminal: () => {},
		});
		await expect(send(op("delete", "d1"))).resolves.toBe("ok");
	});

	test("no channel → error (hold and retry)", async () => {
		const send = makeCrdtOpSend({
			channel: () => null,
			onCreated: () => {},
			onTerminal: () => {},
		});
		await expect(send(op("create", "d1"))).resolves.toBe("error");
	});

	test("retryable reason (rate_limited) → error, not surfaced", async () => {
		const onTerminal = mock(() => {});
		const send = makeCrdtOpSend({
			channel: () =>
				fakeChannel({
					crdtCreate: async () => Promise.reject(serverError("rate_limited")),
				}),
			onCreated: () => {},
			onTerminal,
		});
		await expect(send(op("create", "d1"))).resolves.toBe("error");
		expect(onTerminal).not.toHaveBeenCalled();
	});

	test("timeout → timeout", async () => {
		const send = makeCrdtOpSend({
			channel: () =>
				fakeChannel({
					crdtDeleteAcked: async () =>
						Promise.reject(new Error("sendRequest timeout: crdt_delete")),
				}),
			onCreated: () => {},
			onTerminal: () => {},
		});
		await expect(send(op("delete", "d1"))).resolves.toBe("timeout");
	});

	test("terminal reason (id_conflict) → ok (removed) AND surfaced", async () => {
		const onTerminal = mock(() => {});
		const send = makeCrdtOpSend({
			channel: () =>
				fakeChannel({ crdtCreate: async () => Promise.reject(serverError("id_conflict")) }),
			onCreated: () => {},
			onTerminal,
		});
		await expect(send(op("create", "d1"))).resolves.toBe("ok");
		expect(onTerminal).toHaveBeenCalledTimes(1);
		expect(onTerminal.mock.calls[0]?.[1]).toBe("id_conflict");
	});

	test("notes_cap_reached → error (retryable), routed to onLimit not onTerminal", async () => {
		const onTerminal = mock(() => {});
		const onLimit = mock(() => {});
		const send = makeCrdtOpSend({
			channel: () =>
				fakeChannel({
					crdtCreate: async () => Promise.reject(serverError("notes_cap_reached")),
				}),
			onCreated: () => {},
			onTerminal,
			onLimit,
		});
		// The plan note-cap is TRANSIENT (freeing a note / upgrading clears it): the
		// op must be RETRIED (→ "error", kept in the queue), never dropped as terminal.
		await expect(send(op("create", "d1"))).resolves.toBe("error");
		expect(onTerminal).not.toHaveBeenCalled();
		expect(onLimit).toHaveBeenCalledTimes(1);
		expect(onLimit.mock.calls[0]?.[1]).toBe("notes_cap_reached");
	});

	test("notes_cap_reached surfaces to the user ONCE across retries (no toast spam)", async () => {
		const onLimit = mock(() => {});
		const send = makeCrdtOpSend({
			channel: () =>
				fakeChannel({
					crdtCreate: async () => Promise.reject(serverError("notes_cap_reached")),
				}),
			onCreated: () => {},
			onTerminal: () => {},
			onLimit,
		});
		const capOp = op("create", "d1");
		await expect(send(capOp)).resolves.toBe("error");
		await expect(send(capOp)).resolves.toBe("error"); // retried on the next tick
		expect(onLimit).toHaveBeenCalledTimes(1);
	});
});

describe("CrdtOpQueue integration (durable create/delete)", () => {
	function harness(sendImpl: (o: CrdtOp) => Promise<"ok" | "error" | "timeout">) {
		let now = 1000;
		const dropped: Array<{ op: CrdtOp; reason: DropReason }> = [];
		const queue = new CrdtOpQueue({
			send: sendImpl,
			now: () => now,
			onDrop: (o, reason) => dropped.push({ op: o, reason }),
			options: { baseBackoffMs: 10, maxBackoffMs: 10 },
		});
		const advance = (ms: number) => {
			now += ms;
		};
		return { queue, dropped, advance };
	}

	test("an op issued while NOT joined is HELD (nothing sent)", async () => {
		const sent: CrdtOp[] = [];
		const { queue } = harness(async (o) => {
			sent.push(o);
			return "ok";
		});
		queue.enqueue(op("delete", "d1"));
		// No onJoined yet → flush is a no-op.
		await queue.tick();
		expect(sent).toEqual([]);
		expect(queue.size()).toBe(1);
	});

	test("onJoined flushes held ops and a server ok removes them", async () => {
		const sent: CrdtOp[] = [];
		const { queue } = harness(async (o) => {
			sent.push(o);
			return "ok";
		});
		queue.enqueue(op("create", "c1"));
		queue.enqueue(op("delete", "d1"));
		await queue.onJoined();
		expect(sent.map((o) => o.docId).sort()).toEqual(["c1", "d1"]);
		expect(queue.size()).toBe(0);
	});

	test("a terminal reply removes the op (no infinite retry) and it never resends", async () => {
		let calls = 0;
		// send returns "ok" for a terminal error (the dispatch maps terminal→"ok"
		// to REMOVE it); count how many times it is actually dispatched.
		const { queue } = harness(async () => {
			calls += 1;
			return "ok"; // terminal-mapped
		});
		queue.enqueue(op("create", "c1"));
		await queue.onJoined();
		expect(queue.size()).toBe(0);
		// Further ticks must not resurrect/resend it.
		await queue.tick();
		await queue.tick();
		expect(calls).toBe(1);
	});

	test("a retryable failure is retried on the next due tick, then acked", async () => {
		let attempt = 0;
		const { queue, advance } = harness(async () => {
			attempt += 1;
			return attempt === 1 ? "error" : "ok";
		});
		queue.enqueue(op("delete", "d1"));
		await queue.onJoined(); // attempt 1 → error, backoff scheduled
		expect(queue.size()).toBe(1);
		advance(50); // past the 10ms backoff
		await queue.tick(); // attempt 2 → ok
		expect(attempt).toBe(2);
		expect(queue.size()).toBe(0);
	});

	test("persistence load restores a pending create and delete", async () => {
		const sent: CrdtOp[] = [];
		const { queue } = harness(async (o) => {
			sent.push(o);
			return "ok";
		});
		queue.load([op("create", "c1"), op("delete", "d1")]);
		expect(queue.size()).toBe(2);
		await queue.onJoined();
		expect(sent.map((o) => o.docId).sort()).toEqual(["c1", "d1"]);
		expect(queue.size()).toBe(0);
	});
});

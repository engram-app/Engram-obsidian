/**
 * AttachmentDeleteBatcher: origin gating, vault pinning, ordering and the
 * unload hand-off (PR 671 reviews). Deterministic: timers fired by hand,
 * scripted sends.
 */
import { describe, expect, test } from "bun:test";
import {
	ATTACHMENT_DELETE_CHUNK,
	AttachmentDeleteBatcher,
	VaultSwitchedError,
} from "../src/attachment-delete-batcher";

type Sent = { paths: string[]; vaultId: string | null };

function harness(opts: { batch?: boolean; send?: (s: Sent) => Promise<void> } = {}) {
	let vault: string | null = "A";
	const sent: Sent[] = [];
	const single: Sent[] = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const track = async (fn: () => Promise<void>) => {
		maxInFlight = Math.max(maxInFlight, ++inFlight);
		try {
			await fn();
		} finally {
			inFlight--;
		}
	};
	const b = new AttachmentDeleteBatcher({
		send: (paths, vaultId) =>
			track(async () => {
				sent.push({ paths, vaultId });
				await opts.send?.({ paths, vaultId });
			}),
		sendOne: (path, vaultId) =>
			track(async () => {
				single.push({ paths: [path], vaultId });
				await Promise.resolve();
			}),
		batchEnabled: () => opts.batch ?? true,
		activeVaultId: () => vault,
		setTimeout: () => 1,
		clearTimeout: () => {},
	});
	return {
		b,
		sent,
		single,
		maxInFlight: () => maxInFlight,
		setVault: (v: string | null) => {
			vault = v;
		},
	};
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const gate = () => {
	let release!: () => void;
	const p = new Promise<void>((r) => {
		release = r;
	});
	return { p, release };
};

describe("AttachmentDeleteBatcher", () => {
	// Delta review M1: batching is only safe when the server's batch broadcast
	// names this device, so without the capability every delete goes out as a
	// single DELETE (which always carried X-Device-Id), still one at a time.
	test("without the origin capability: single deletes, serial, never a batch", async () => {
		const h = harness({ batch: false });
		const ps = Array.from({ length: 50 }, (_, i) => h.b.delete(`p${i}.png`, "A"));
		await h.b.flush();
		await Promise.all(ps);
		expect(h.sent).toEqual([]);
		expect(h.single).toHaveLength(50);
		expect(h.maxInFlight()).toBe(1);
	});

	test("with the capability: 400 deletes become 2 batch requests, one in flight", async () => {
		const h = harness();
		const ps = Array.from({ length: 400 }, (_, i) => h.b.delete(`p${i}.png`, "A"));
		await h.b.flush();
		await Promise.all(ps);
		expect(h.sent).toHaveLength(Math.ceil(400 / ATTACHMENT_DELETE_CHUNK));
		expect(h.maxInFlight()).toBe(1);
	});

	test("a vault switch before the send rejects the deletes, sends nothing", async () => {
		const h = harness();
		const p = h.b.delete("img/a.png", "A");
		h.setVault("B");
		await h.b.flush();
		await expect(p).rejects.toBeInstanceOf(VaultSwitchedError);
		expect(h.sent).toEqual([]);
	});

	test("each chunk carries the vault its caller stamped", async () => {
		const h = harness();
		h.setVault("B");
		await Promise.all([h.b.delete("b.png", "B"), h.b.flush()]);
		expect(h.sent).toEqual([{ paths: ["b.png"], vaultId: "B" }]);
	});

	test("settled(path) waits for a delete that is already IN FLIGHT", async () => {
		const g = gate();
		const h = harness({ send: () => g.p });
		void h.b.delete("x.png", "A");
		void h.b.flush();
		await tick();
		let done = false;
		const waiting = h.b.settled("x.png").then(() => {
			done = true;
		});
		await tick();
		expect(done).toBe(false);
		g.release();
		await waiting;
		expect(done).toBe(true);
	});

	test("a failed chunk rejects only its own callers", async () => {
		let n = 0;
		const h = harness({
			send: async () => {
				if (++n === 2) throw Object.assign(new Error("boom"), { status: 500 });
			},
		});
		const ps = Array.from({ length: ATTACHMENT_DELETE_CHUNK + 1 }, (_, i) =>
			h.b.delete(`p${i}.png`, "A").then(
				() => "ok",
				() => "err",
			),
		);
		await h.b.flush();
		const results = await Promise.all(ps);
		expect(results.slice(0, ATTACHMENT_DELETE_CHUNK).every((r) => r === "ok")).toBe(true);
		expect(results[ATTACHMENT_DELETE_CHUNK]).toBe("err");
	});

	// Delta review M3: unload took only the 100 ms window; chunks queued behind
	// the in-flight one went out after auth was retired and were lost.
	test("takeUnacked returns the in-flight chunk, every queued chunk and the window", async () => {
		const g = gate();
		const h = harness({ send: () => g.p });
		const total = 2 * ATTACHMENT_DELETE_CHUNK + 50;
		for (let i = 0; i < total; i++) void h.b.delete(`p${i}.png`, "A");
		void h.b.flush(); // chunk 1 in flight, 2 and 3 queued
		await tick();
		void h.b.delete("late.png", "A"); // still in the window
		const taken = h.b.takeUnacked();
		expect(taken).toHaveLength(total + 1);
		expect(new Set(taken.map((t) => t.vaultId))).toEqual(new Set(["A"]));
		g.release();
		await h.b.flush();
		await tick();
		expect(h.sent).toHaveLength(1); // nothing sent after the hand-off
	});

	// Delta 2 L2: unload woke uploads waiting on a delete, so one could land
	// before its own saved delete replayed on the next start.
	test("takeUnacked leaves uploads waiting on those paths parked", async () => {
		const h = harness();
		void h.b.delete("x.png", "A");
		let woke = false;
		void h.b.settled("x.png").then(() => {
			woke = true;
		});
		h.b.takeUnacked();
		await tick();
		await tick();
		expect(woke).toBe(false);
	});

	// Delta 2 L3: a single DELETE 404 from VaultPlug ("Vault not found") is
	// not "already gone"; counting it as done lost the delete.
	test("a vault-not-found 404 rejects; any other 404 counts as already gone", async () => {
		let body = "Vault not found";
		const b = new AttachmentDeleteBatcher({
			send: async () => {},
			sendOne: async () => {
				throw Object.assign(new Error("404"), { status: 404, json: { error: body } });
			},
			batchEnabled: () => false,
			activeVaultId: () => "A",
			setTimeout: () => 1,
			clearTimeout: () => {},
		});
		const lost = b.delete("a.png", "A");
		await b.flush();
		await expect(lost).rejects.toMatchObject({ status: 404 });
		body = "not_found";
		const gone = b.delete("b.png", "A");
		await b.flush();
		await expect(gone).resolves.toBeUndefined();
	});
});

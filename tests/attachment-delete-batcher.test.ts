/**
 * AttachmentDeleteBatcher: the vault, ordering, echo and fallback rules the
 * PR 671 adversarial review found missing (H1, H3, L6, M1, mixed chunks).
 * Deterministic: a manual clock, timers fired by hand, scripted sends.
 */
import { describe, expect, test } from "bun:test";
import {
	ATTACHMENT_DELETE_CHUNK,
	ATTACHMENT_ECHO_MEMORY_MS,
	AttachmentDeleteBatcher,
	VaultSwitchedError,
} from "../src/attachment-delete-batcher";

type Sent = { paths: string[]; vaultId: string | null };

function harness(opts: { send?: (s: Sent) => Promise<void> } = {}) {
	let vault: string | null = "A";
	let now = 1_000;
	const sent: Sent[] = [];
	const single: Sent[] = [];
	let timer: (() => void) | null = null;
	const b = new AttachmentDeleteBatcher({
		send: async (paths, vaultId) => {
			sent.push({ paths, vaultId });
			await opts.send?.({ paths, vaultId });
		},
		sendOne: async (path, vaultId) => {
			single.push({ paths: [path], vaultId });
		},
		activeVaultId: () => vault,
		now: () => now,
		setTimeout: (cb) => {
			timer = cb;
			return 1;
		},
		clearTimeout: () => {
			timer = null;
		},
	});
	return {
		b,
		sent,
		single,
		setVault: (v: string | null) => {
			vault = v;
		},
		advance: (ms: number) => {
			now += ms;
		},
		fire: () => timer?.(),
	};
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("AttachmentDeleteBatcher", () => {
	// H1: before, the vault was read at SEND time, so a switch inside the
	// window sent vault A's deletes into vault B.
	test("a vault switch before the send rejects the deletes, sends nothing", async () => {
		const h = harness();
		const p = h.b.delete("img/a.png");
		h.setVault("B");
		await h.b.flush();
		await expect(p).rejects.toBeInstanceOf(VaultSwitchedError);
		expect(h.sent).toEqual([]);
	});

	test("each chunk carries the vault its deletes were requested in", async () => {
		const h = harness();
		const a = h.b.delete("a.png");
		h.setVault("B");
		const b1 = h.b.delete("b.png");
		await h.b.flush();
		await expect(a).rejects.toBeInstanceOf(VaultSwitchedError);
		await b1;
		expect(h.sent).toEqual([{ paths: ["b.png"], vaultId: "B" }]);
	});

	// H3: before, only deletes still in the window were awaited; one already
	// in flight (or in a later chunk) raced the upload.
	test("settled(path) waits for a delete that is already IN FLIGHT", async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const h = harness({ send: () => gate });
		void h.b.delete("x.png");
		void h.b.flush(); // now in flight
		await settle();
		expect(h.sent).toHaveLength(1);
		let done = false;
		const waiting = h.b.settled("x.png").then(() => {
			done = true;
		});
		await settle();
		expect(done).toBe(false);
		release();
		await waiting;
		expect(done).toBe(true);
	});

	test("settled(path) waits for a delete queued behind another chunk", async () => {
		const h = harness();
		const paths = Array.from({ length: ATTACHMENT_DELETE_CHUNK + 1 }, (_, i) => `p${i}.png`);
		for (const p of paths) void h.b.delete(p);
		void h.b.flush();
		await h.b.settled(paths[ATTACHMENT_DELETE_CHUNK]!);
		expect(h.sent).toHaveLength(2);
	});

	test("a failed chunk rejects only its own callers", async () => {
		let n = 0;
		const h = harness({
			send: async () => {
				if (++n === 2) throw Object.assign(new Error("boom"), { status: 500 });
			},
		});
		const ps = Array.from({ length: ATTACHMENT_DELETE_CHUNK + 1 }, (_, i) =>
			h.b.delete(`p${i}.png`).then(
				() => "ok",
				() => "err",
			),
		);
		await h.b.flush();
		const results = await Promise.all(ps);
		expect(results.slice(0, ATTACHMENT_DELETE_CHUNK).every((r) => r === "ok")).toBe(true);
		expect(results[ATTACHMENT_DELETE_CHUNK]).toBe("err");
	});

	// L6: a backend without the batch route 404s it; before, every delete was
	// silently treated as "already gone".
	test("404 on the batch route falls back to single deletes, then stays there", async () => {
		const h = harness({
			send: async () => {
				throw Object.assign(new Error("nf"), { status: 404 });
			},
		});
		await Promise.all([h.b.delete("a.png"), h.b.delete("b.png"), h.b.flush()]);
		expect(h.single.map((s) => s.paths[0])).toEqual(["a.png", "b.png"]);
		await Promise.all([h.b.delete("c.png"), h.b.flush()]);
		expect(h.sent).toHaveLength(1); // not retried on the batch route
		expect(h.single.map((s) => s.paths[0])).toContain("c.png");
	});

	test("remembers own deletes for the echo window, once", async () => {
		const h = harness();
		await Promise.all([h.b.delete("a.png"), h.b.flush()]);
		expect(h.b.consumeOwnDelete("a.png")).toBe(true);
		expect(h.b.consumeOwnDelete("a.png")).toBe(false);
		await Promise.all([h.b.delete("b.png"), h.b.flush()]);
		h.advance(ATTACHMENT_ECHO_MEMORY_MS + 1);
		expect(h.b.consumeOwnDelete("b.png")).toBe(false);
	});

	test("takePending hands back unsent deletes and sends nothing", async () => {
		const h = harness();
		void h.b.delete("a.png");
		expect(h.b.takePending()).toEqual([{ path: "a.png", vaultId: "A" }]);
		h.fire();
		await h.b.flush();
		expect(h.sent).toEqual([]);
		await h.b.settled("a.png"); // no longer blocks an upload
	});
});

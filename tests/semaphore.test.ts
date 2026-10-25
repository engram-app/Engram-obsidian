import { expect, test } from "bun:test";
import { Semaphore } from "../src/semaphore";

test("never exceeds max holders, wakes waiters in order, releases on throw", async () => {
	const s = new Semaphore(2);
	let peak = 0;
	const order: number[] = [];
	const job = (i: number) =>
		s.run(async () => {
			peak = Math.max(peak, s.active);
			await new Promise((r) => setTimeout(r, 1));
			order.push(i);
			if (i === 1) throw new Error("boom");
		});
	const results = await Promise.allSettled([0, 1, 2, 3, 4].map(job));
	expect(peak).toBe(2);
	expect(s.active).toBe(0);
	expect(results[1].status).toBe("rejected");
	expect(order.sort()).toEqual([0, 1, 2, 3, 4]);
});

test("a released slot goes to the waiter, never to a tryAcquire in between", async () => {
	const s = new Semaphore(1);
	expect(s.tryAcquire()).toBe(true);
	let woke = false;
	const waiter = s.acquire().then(() => {
		woke = true;
	});
	s.release();
	expect(s.tryAcquire()).toBe(false);
	await waiter;
	expect(woke).toBe(true);
	expect(s.active).toBe(1);
});

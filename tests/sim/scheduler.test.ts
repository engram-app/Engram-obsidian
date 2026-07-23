// tests/sim/scheduler.test.ts
import { expect, test } from "bun:test";
import { SimClock } from "./clock";
import { Scheduler } from "./scheduler";

async function trace(seed: number): Promise<string[]> {
	const clock = new SimClock();
	const s = new Scheduler(seed, clock);
	const out: string[] = [];
	for (const name of ["a", "b", "c"])
		s.enqueue("net", () => {
			out.push(name);
		});
	clock.setTimeout(() => out.push("t1"), 10);
	while (await s.step()) {}
	return out;
}

test("same seed → same interleaving", async () => {
	expect(await trace(42)).toEqual(await trace(42));
});
test("different seed → different interleaving (statistically)", async () => {
	// This scenario has a small decision space (all 3 items share one lane,
	// so each step is a binary choice: pop lane vs fire timer), so a couple
	// of adjacent small seeds can coincidentally collide. Sample a wider
	// spread of seeds so the "statistically different" intent holds robustly
	// rather than depending on 2-3 specific seeds not colliding by chance.
	const traces = new Set<string>();
	for (let seed = 1; seed <= 12; seed++) traces.add(JSON.stringify(await trace(seed)));
	expect(traces.size).toBeGreaterThan(1);
});
test("drain empties lanes and timers", async () => {
	const clock = new SimClock();
	const s = new Scheduler(7, clock);
	let n = 0;
	s.enqueue("net", () => {
		n++;
	});
	clock.setTimeout(() => n++, 50);
	await s.drain();
	expect(n).toBe(2);
	expect(clock.pendingCount()).toBe(0);
});

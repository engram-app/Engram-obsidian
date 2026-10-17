import { describe, expect, test } from "bun:test";
import { ManualTimeProvider } from "../src/time-provider";
import { TrailingThrottle } from "../src/trailing-throttle";

const flush = async () => {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("TrailingThrottle", () => {
	test("stays single-flight across reset(): a poke after reset waits for the in-flight run", async () => {
		const time = new ManualTimeProvider(0);
		let runs = 0;
		let active = 0;
		let maxActive = 0;
		const releases: Array<() => void> = [];
		const t = new TrailingThrottle(
			time,
			() => 1_000,
			async () => {
				runs++;
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise<void>((r) => releases.push(r));
				active--;
			},
		);
		t.poke();
		t.reset();
		t.poke();
		await flush();
		expect(runs).toBe(1);

		releases[0]();
		await flush();
		// The post-reset poke runs now, with no cooldown inherited from before.
		expect(runs).toBe(2);
		expect(maxActive).toBe(1);
		releases[1]();
		await flush();
	});

	test("an urgent poke skips the gap once, then the gap applies again", async () => {
		const time = new ManualTimeProvider(0);
		let runs = 0;
		const t = new TrailingThrottle(
			time,
			() => 1_000,
			async () => {
				runs++;
			},
		);
		t.poke();
		await flush();
		t.poke(true);
		await flush();
		expect(runs).toBe(2);
		t.poke(true);
		await flush();
		expect(runs).toBe(2);
		time.advance(1_000);
		await flush();
		expect(runs).toBe(3);
	});

	test("a run that reports it did nothing stamps no cooldown", async () => {
		const time = new ManualTimeProvider(0);
		let runs = 0;
		let noop = true;
		const t = new TrailingThrottle(
			time,
			() => 1_000,
			async () => {
				runs++;
				return !noop;
			},
		);
		t.poke();
		await flush();
		noop = false;
		t.poke();
		await flush();
		expect(runs).toBe(2);
	});
});

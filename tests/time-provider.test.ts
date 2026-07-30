import { describe, expect, test } from "bun:test";
import { ManualTimeProvider } from "../src/time-provider";

describe("ManualTimeProvider", () => {
	test("does not fire a timeout before it is due", () => {
		const clock = new ManualTimeProvider();
		let fired = false;
		clock.setTimeout(() => {
			fired = true;
		}, 60_000);

		clock.advance(59_999);

		expect(fired).toBe(false);
	});

	test("fires a timeout once its window elapses", () => {
		const clock = new ManualTimeProvider();
		let fired = false;
		clock.setTimeout(() => {
			fired = true;
		}, 60_000);

		clock.advance(60_000);

		expect(fired).toBe(true);
	});

	test("clearTimeout cancels a pending timer", () => {
		const clock = new ManualTimeProvider();
		let fired = false;
		const id = clock.setTimeout(() => {
			fired = true;
		}, 100);

		clock.clearTimeout(id);
		clock.advance(1000);

		expect(fired).toBe(false);
	});

	test("fires timers in due order, not insertion order", () => {
		const clock = new ManualTimeProvider();
		const order: string[] = [];
		clock.setTimeout(() => order.push("late"), 200);
		clock.setTimeout(() => order.push("early"), 100);

		clock.advance(500);

		expect(order).toEqual(["early", "late"]);
	});

	test("now() reflects the time a callback actually ran at", () => {
		const clock = new ManualTimeProvider(1000);
		let observed = -1;
		clock.setTimeout(() => {
			observed = clock.now();
		}, 250);

		clock.advance(900);

		// Not 1900 (the end of the advanced window) — the callback ran at its due
		// instant, which is what a TTL check inside it would observe.
		expect(observed).toBe(1250);
	});

	test("an interval repeats across a long advance", () => {
		const clock = new ManualTimeProvider();
		let ticks = 0;
		clock.setInterval(() => {
			ticks++;
		}, 100);

		clock.advance(350);

		expect(ticks).toBe(3);
	});
});

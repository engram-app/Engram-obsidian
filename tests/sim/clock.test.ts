// tests/sim/clock.test.ts
import { describe, expect, test } from "bun:test";
import { SimClock } from "./clock";

describe("SimClock", () => {
	test("fires timers in deadline order, deterministically", () => {
		const clock = new SimClock();
		const fired: string[] = [];
		clock.setTimeout(() => fired.push("b"), 20);
		clock.setTimeout(() => fired.push("a"), 10);
		clock.setTimeout(() => fired.push("c"), 20); // tie with b — registration order
		while (clock.fireNext()) {}
		expect(fired).toEqual(["a", "b", "c"]);
		expect(clock.now()).toBe(20);
	});

	test("install() captures window.setTimeout callers", () => {
		const clock = new SimClock();
		const uninstall = clock.install(globalThis.window);
		let ran = false;
		window.setTimeout(() => {
			ran = true;
		}, 5000);
		expect(clock.pendingCount()).toBe(1);
		clock.fireNext();
		expect(ran).toBe(true);
		uninstall();
	});

	test("clearTimeout cancels", () => {
		const clock = new SimClock();
		let ran = false;
		const id = clock.setTimeout(() => {
			ran = true;
		}, 10);
		clock.clearTimeout(id);
		expect(clock.fireNext()).toBe(false);
		expect(ran).toBe(false);
	});
});

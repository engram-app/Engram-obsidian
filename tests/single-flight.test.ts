import { createSingleFlight } from "../src/single-flight";

describe("createSingleFlight", () => {
	it("drops a concurrent call while one is in flight", async () => {
		const guard = createSingleFlight();
		let runs = 0;
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));

		const first = guard(async () => {
			runs++;
			await gate;
			return "done";
		});
		const second = await guard(async () => {
			runs++;
			return "second";
		});

		expect(second).toBeUndefined();
		expect(runs).toBe(1);
		release();
		expect(await first).toBe("done");
	});

	it("runs again after the prior call resolves", async () => {
		const guard = createSingleFlight();
		expect(await guard(async () => "a")).toBe("a");
		expect(await guard(async () => "b")).toBe("b");
	});

	it("clears the flag when fn throws", async () => {
		const guard = createSingleFlight();
		await expect(
			guard(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await guard(async () => "ok")).toBe("ok");
	});
});

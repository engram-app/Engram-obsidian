import { describe, expect, it } from "bun:test";
import { uuid7 } from "../src/crdt/uuid7";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("uuid7", () => {
	it("produces a well-formed UUID string", () => {
		expect(uuid7()).toMatch(UUID_RE);
	});

	it("sets the version nibble to 7", () => {
		const id = uuid7();
		expect(id[14]).toBe("7");
	});

	it("sets the variant bits to 10xx", () => {
		const id = uuid7();
		const variantNibble = Number.parseInt(id[19] ?? "0", 16);
		expect(variantNibble & 0b1100).toBe(0b1000);
	});

	it("is monotonic-ish: later timestamps sort after earlier ones", () => {
		const original = Date.now;
		try {
			let now = 1_700_000_000_000;
			Date.now = () => now;
			const first = uuid7();
			now += 1000; // advance the clock by 1s
			const second = uuid7();
			expect(second > first).toBe(true);
		} finally {
			Date.now = original;
		}
	});

	it("does not repeat across many calls (random tail)", () => {
		const ids = new Set(Array.from({ length: 100 }, () => uuid7()));
		expect(ids.size).toBe(100);
	});
});

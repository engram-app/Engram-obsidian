import { describe, expect, test } from "bun:test";
import { arrayBufferToBase64 } from "../src/api";
import { fnv1a, fnv1aBase64 } from "../src/content-hash";

// fnv1aBase64 is the attachment sync hash computed straight from bytes. It
// must equal fnv1a over the base64 string the push side hashes, or every
// raw-downloaded attachment would look locally modified and re-upload.
describe("fnv1aBase64", () => {
	const same = (bytes: Uint8Array) =>
		expect(fnv1aBase64(bytes.buffer as ArrayBuffer)).toBe(
			fnv1a(arrayBufferToBase64(bytes.buffer as ArrayBuffer)),
		);

	test("empty input hashes like the empty string", () => {
		expect(fnv1aBase64(new ArrayBuffer(0))).toBe(fnv1a(""));
	});

	test("every padding case (lengths 1..8)", () => {
		for (let n = 1; n <= 8; n++) same(new Uint8Array(n).map((_, i) => 250 - i * 31));
	});

	test("all 256 byte values", () => {
		same(Uint8Array.from({ length: 256 }, (_, i) => i));
	});

	test("random 1 MB + 1 byte", () => {
		same(new Uint8Array(1_000_001).map(() => (Math.random() * 256) | 0));
	});

	test("hashes the buffer's full view, not a stale subarray", () => {
		const big = new Uint8Array([9, 9, 1, 2, 3]);
		same(big.slice(2));
	});
});

import { describe, expect, test } from "bun:test";
import { NoteDestroyedError } from "../src/crdt/destroyed-error";
import { Lifetime } from "../src/lifetime";

describe("Lifetime", () => {
	test("passes a resolved value through while active", async () => {
		const lifetime = new Lifetime();

		await expect(lifetime.guard(Promise.resolve("ok"))).resolves.toBe("ok");
	});

	test("rejects immediately when already ended", async () => {
		const lifetime = new Lifetime();
		lifetime.end(new NoteDestroyedError("id-a"));

		await expect(lifetime.guard(Promise.resolve("ok"))).rejects.toThrow(NoteDestroyedError);
	});

	test("abandons an in-flight operation the moment the lifetime ends", async () => {
		const lifetime = new Lifetime();
		// Never settles — a post-await `if (destroyed) return` would hang here
		// forever, which is the whole weakness of that pattern.
		const guarded = lifetime.guard(new Promise<string>(() => {}));

		lifetime.end(new NoteDestroyedError("id-a"));

		await expect(guarded).rejects.toThrow(NoteDestroyedError);
	});

	test("does not resume into dead state when work resolves after the end", async () => {
		const lifetime = new Lifetime();
		let resolveLate: (v: string) => void = () => {};
		const late = new Promise<string>((r) => {
			resolveLate = r;
		});
		const guarded = lifetime.guard(late);

		lifetime.end(new NoteDestroyedError("id-a"));
		resolveLate("too late");

		await expect(guarded).rejects.toThrow(NoteDestroyedError);
	});

	test("aborts the signal handed to the operation", async () => {
		const lifetime = new Lifetime();
		let aborted = false;
		const guarded = lifetime.guard((signal) => {
			signal.addEventListener("abort", () => {
				aborted = true;
			});
			return new Promise<string>(() => {});
		});

		lifetime.end(new NoteDestroyedError("id-a"));
		await guarded.catch(() => {});

		expect(aborted).toBe(true);
	});

	test("propagates a genuine operation failure unchanged", async () => {
		const lifetime = new Lifetime();

		await expect(lifetime.guard(Promise.reject(new Error("disk full")))).rejects.toThrow(
			"disk full",
		);
	});

	test("end is idempotent and keeps the first reason", () => {
		const lifetime = new Lifetime();
		const first = new NoteDestroyedError("id-a");
		lifetime.end(first);
		lifetime.end(new Error("second"));

		expect(lifetime.active).toBe(false);
		expect(lifetime.reason).toBe(first);
	});

	test("onEnded fires immediately for an already-ended lifetime", () => {
		const lifetime = new Lifetime();
		lifetime.end(new NoteDestroyedError("id-a"));
		let seen: unknown = null;

		lifetime.onEnded((reason) => {
			seen = reason;
		});

		expect(seen).toBeInstanceOf(NoteDestroyedError);
	});
});

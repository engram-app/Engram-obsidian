import { describe, expect, test } from "bun:test";
import { FeedbackState } from "../src/tabs/feedback-tab";

describe("FeedbackState", () => {
	test("cannot submit a blank message", () => {
		const state = new FeedbackState();
		expect(state.canSubmit()).toBe(false);
		state.message = "   ";
		expect(state.canSubmit()).toBe(false);
		state.message = "hi";
		expect(state.canSubmit()).toBe(true);
	});

	test("sends the trimmed message with the picked fields", async () => {
		const state = new FeedbackState();
		state.message = "  sync broke  ";
		state.category = "bug";
		state.mood = 1;
		state.contactOk = true;
		let sent: unknown;
		await state.submit(async (f) => {
			sent = f;
		});
		expect(sent).toEqual({ message: "sync broke", category: "bug", mood: 1, contactOk: true });
		expect(state.view).toBe("sent");
	});

	test("keeps the text and shows an error when sending fails", async () => {
		const state = new FeedbackState();
		state.message = "sync broke";
		await state.submit(async () => {
			throw new Error("boom");
		});
		expect(state.view).toBe("error");
		expect(state.message).toBe("sync broke");
	});

	test("ignores a second submit while one is in flight", async () => {
		const state = new FeedbackState();
		state.message = "hi";
		let calls = 0;
		let release!: () => void;
		const first = state.submit(
			() =>
				new Promise<void>((r) => {
					calls++;
					release = r;
				}),
		);
		expect(state.canSubmit()).toBe(false);
		await state.submit(async () => {
			calls++;
		});
		release();
		await first;
		expect(calls).toBe(1);
	});

	test("picking the same category or mood again clears it", () => {
		const state = new FeedbackState();
		state.toggleCategory("idea");
		expect(state.category).toBe("idea");
		state.toggleCategory("idea");
		expect(state.category).toBeNull();
		state.toggleMood(4);
		state.toggleMood(4);
		expect(state.mood).toBeNull();
	});
});

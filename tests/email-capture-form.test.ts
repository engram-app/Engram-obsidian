/**
 * Tests for renderEmailCaptureForm — the shared input + submit wiring used by
 * both the first-run modal and the Welcome-tab inline form. The Obsidian DOM
 * helpers are stubbed with a local tree adapter that also captures event
 * listeners so we can drive the submit flow without a real DOM.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EmailCaptureState, renderEmailCaptureForm } from "../src/email-capture-modal";

interface FakeEl {
	tag: string;
	cls: string;
	text: string;
	value: string;
	disabled: boolean;
	focused: boolean;
	listeners: Record<string, ((e: { key?: string }) => void)[]>;
	children: FakeEl[];
	createEl: (tag: string, opts?: { cls?: string; text?: string }) => FakeEl;
	createDiv: (opts?: { cls?: string }) => FakeEl;
	addEventListener: (ev: string, fn: (e: { key?: string }) => void) => void;
	focus: () => void;
	empty: () => void;
}

function makeEl(tag: string, opts?: { cls?: string; text?: string }): FakeEl {
	const el: FakeEl = {
		tag,
		cls: opts?.cls ?? "",
		text: opts?.text ?? "",
		value: "",
		disabled: false,
		focused: false,
		listeners: {},
		children: [],
		createEl: (t, o) => {
			const child = makeEl(t, o);
			el.children.push(child);
			return child;
		},
		createDiv: (o) => el.createEl("div", o),
		addEventListener: (ev, fn) => {
			el.listeners[ev] ??= [];
			el.listeners[ev].push(fn);
		},
		focus: () => {
			el.focused = true;
		},
		empty: () => {
			el.children.length = 0;
		},
	};
	return el;
}

function find(el: FakeEl, pred: (e: FakeEl) => boolean): FakeEl | undefined {
	for (const child of el.children) {
		if (pred(child)) return child;
		const nested = find(child, pred);
		if (nested) return nested;
	}
	return undefined;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("renderEmailCaptureForm", () => {
	let container: FakeEl;
	let state: EmailCaptureState;
	let send: ReturnType<typeof mock>;

	const render = (): void => {
		container.empty();
		if (state.view === "success") {
			container.createEl("p", { cls: "success", text: "done" });
			return;
		}
		renderEmailCaptureForm({
			parent: container as unknown as HTMLElement,
			state,
			rerender: render,
			send,
		});
	};

	beforeEach(() => {
		container = makeEl("div");
		state = new EmailCaptureState();
		send = mock(async () => {});
		render();
	});

	const input = () => find(container, (e) => e.tag === "input");
	const notifyBtn = () => find(container, (e) => e.text === "Notify me");
	const click = (el: FakeEl) => el.listeners.click?.[0]?.({});

	test("renders an email input and a Notify me button, and focuses the input", () => {
		expect(input()).toBeDefined();
		expect(notifyBtn()).toBeDefined();
		expect(input()?.focused).toBe(true);
	});

	test("invalid email: does not call send, shows a validation error", async () => {
		const i = input();
		if (!i) throw new Error("no input");
		i.value = "nope";
		const btn = notifyBtn();
		if (btn) click(btn);
		await flush();
		expect(send).not.toHaveBeenCalled();
		expect(find(container, (e) => e.cls === "engram-email-capture-error")?.text).toMatch(
			/valid email/i,
		);
	});

	test("valid email: calls send with the address and lands on success", async () => {
		const i = input();
		if (!i) throw new Error("no input");
		i.value = "a@b.com";
		const btn = notifyBtn();
		if (btn) click(btn);
		await flush();
		expect(send).toHaveBeenCalledWith("a@b.com");
		expect(state.view).toBe("success");
		expect(find(container, (e) => e.cls === "success")).toBeDefined();
	});

	test("send failure surfaces an inline error and does not throw", async () => {
		send = mock(async () => {
			throw new Error("network");
		});
		container = makeEl("div");
		state = new EmailCaptureState();
		render();
		const i = input();
		if (!i) throw new Error("no input");
		i.value = "a@b.com";
		const btn = notifyBtn();
		if (btn) click(btn);
		await flush();
		expect(state.view).toBe("error");
		expect(find(container, (e) => e.cls === "engram-email-capture-error")?.text).toMatch(
			/try again/i,
		);
	});
});

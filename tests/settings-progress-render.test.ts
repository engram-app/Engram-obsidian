/**
 * Tests for the settings pane's progress-bar render callback (#375).
 *
 * On Obsidian 1.13+ the settings row can be torn down and recreated WITHOUT
 * the tab's hide() firing — so the installed render callback survives with a
 * closure over detached DOM. It must go inert (no renders into, and no
 * retention-visible writes on, detached nodes) exactly like renderStatus()'s
 * isConnected guard, and come back to life if the container is reattached.
 *
 * Exercised through the extracted, DOM-agnostic `makeProgressBarRender`
 * factory with a minimal fake-element adapter (same approach as
 * sync-progress-modal.test.ts / renderCompletionSummary).
 */
import { describe, expect, test } from "bun:test";
import { makeProgressBarRender } from "../src/settings";
import type { PlannedPhase } from "../src/sync-progress-modal";
import type { SyncProgress } from "../src/types";

interface FakeProgressEls {
	container: {
		isConnected: boolean;
		classes: Set<string>;
		addClass: (c: string) => void;
		removeClass: (c: string) => void;
		hasClass: (c: string) => boolean;
	};
	label: { text: string; setText: (t: string) => void };
	barInner: { style: { width: string } };
}

function makeEls(): FakeProgressEls {
	const classes = new Set<string>();
	return {
		container: {
			isConnected: true,
			classes,
			addClass: (c) => classes.add(c),
			removeClass: (c) => classes.delete(c),
			hasClass: (c) => classes.has(c),
		},
		label: {
			text: "",
			setText(t: string) {
				this.text = t;
			},
		},
		barInner: { style: { width: "" } },
	};
}

function makeRender(els: FakeProgressEls, phases: PlannedPhase[] | null = null) {
	return makeProgressBarRender(
		els.container as unknown as HTMLElement,
		els.label as unknown as HTMLElement,
		els.barInner as unknown as HTMLElement,
		() => phases,
	);
}

const pushing = (current: number, total: number, failed = 0): SyncProgress => ({
	phase: "pushing",
	current,
	total,
	failed,
});

describe("settings progress-bar render (teardown-without-hide, #375)", () => {
	test("renders label, bar width, and is-active while connected", () => {
		const els = makeEls();
		const render = makeRender(els);
		render(pushing(5, 10));
		expect(els.container.hasClass("is-active")).toBe(true);
		expect(els.label.text).toBe("Uploading... 5/10");
		expect(els.barInner.style.width).toBe("50%");
	});

	test("detached container: render is a no-op", () => {
		const els = makeEls();
		const render = makeRender(els);
		els.container.isConnected = false;
		render(pushing(5, 10));
		expect(els.container.hasClass("is-active")).toBe(false);
		expect(els.label.text).toBe("");
		expect(els.barInner.style.width).toBe("");
	});

	test("detached container: 'complete' is also a no-op (no crash)", () => {
		const els = makeEls();
		const render = makeRender(els);
		render(pushing(5, 10));
		els.container.isConnected = false;
		expect(() =>
			render({ phase: "complete", current: 10, total: 10, failed: 0 }),
		).not.toThrow();
		// is-active is stale but the node is detached; next open re-renders fresh.
		expect(els.label.text).toBe("Uploading... 5/10");
	});

	test("reattached container renders again on the next event", () => {
		const els = makeEls();
		const render = makeRender(els);
		els.container.isConnected = false;
		render(pushing(3, 10));
		els.container.isConnected = true;
		render(pushing(6, 10));
		expect(els.container.hasClass("is-active")).toBe(true);
		expect(els.label.text).toBe("Uploading... 6/10");
		expect(els.barInner.style.width).toBe("60%");
	});

	test("complete hides the bar and a following sync starts with cleared totals", () => {
		const els = makeEls();
		const render = makeRender(els);
		// Fallback (plan-less) row seeds prevTotals with its engine total…
		render(pushing(5, 10));
		render({ phase: "complete", current: 10, total: 10, failed: 0 });
		expect(els.container.hasClass("is-active")).toBe(false);
		// …and after complete, a plan-less 0-total event must NOT inherit the
		// old denominator: indeterminate display, no "1/10".
		render(pushing(1, 0));
		expect(els.label.text).toBe("Uploading... 1");
	});
});

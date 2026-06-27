/**
 * Tests for the sync progress modal's completion summary — specifically the
 * three-way ✓ synced · ⤳ skipped (plan) · ✕ failed tally added for plan-gated
 * attachments (Free-tier launch). Plan-skipped attachments are counted as
 * "skipped", never "failed".
 *
 * The render is exercised through the extracted, DOM-agnostic
 * `renderCompletionSummary(parent, summary)` helper, using the same lightweight
 * FakeEl tree adapter sync-center-render.test.ts uses — so we can assert on
 * emitted text + structure without a real DOM.
 */
import { describe, expect, test } from "bun:test";
import {
	type CompletionSummary,
	describePlannedWork,
	renderCompletionSummary,
} from "../src/sync-progress-modal";
import type { SyncPlan } from "../src/types";

interface FakeEl {
	cls: string;
	tag: string;
	text: string;
	attrs: Record<string, string>;
	hidden: boolean;
	clickHandlers: Array<() => void>;
	children: FakeEl[];
	createDiv: (o?: { cls?: string; text?: string }) => HTMLElement;
	createSpan: (o?: { cls?: string; text?: string }) => HTMLElement;
	createEl: (t: string, o?: { cls?: string; text?: string }) => HTMLElement;
	setText: (t: string) => FakeEl;
	setAttribute: (k: string, v: string) => FakeEl;
	addClass: (c: string) => FakeEl;
	addEventListener: (type: string, cb: () => void) => void;
	empty: () => void;
}

function makeFakeEl(tag: string, opts?: { cls?: string; text?: string }): FakeEl {
	const el = {
		tag,
		cls: opts?.cls ?? "",
		text: opts?.text ?? "",
		attrs: {} as Record<string, string>,
		hidden: false,
		clickHandlers: [] as Array<() => void>,
		children: [] as FakeEl[],
	} as FakeEl;
	const factory = (childTag: string) => (childOpts?: { cls?: string; text?: string }) => {
		const child = makeFakeEl(childTag, childOpts);
		el.children.push(child);
		return child as unknown as HTMLElement;
	};
	el.createDiv = (o) => factory("div")(o);
	el.createSpan = (o) => factory("span")(o);
	el.createEl = (t, o) => factory(t)(o);
	el.setText = (t: string) => {
		el.text = t;
		return el;
	};
	el.setAttribute = (k: string, v: string) => {
		el.attrs[k] = v;
		return el;
	};
	el.addClass = (c: string) => {
		el.cls = el.cls ? `${el.cls} ${c}` : c;
		return el;
	};
	el.addEventListener = (type: string, cb: () => void) => {
		if (type === "click") el.clickHandlers.push(cb);
	};
	el.empty = () => {
		el.children.length = 0;
	};
	return el;
}

function allText(el: FakeEl): string {
	const out: string[] = [];
	const visit = (n: FakeEl) => {
		if (n.text) out.push(n.text);
		for (const c of n.children) visit(c);
	};
	visit(el);
	return out.join(" | ");
}

function findByCls(el: FakeEl, cls: string): FakeEl | null {
	if (el.cls.split(" ").includes(cls)) return el;
	for (const c of el.children) {
		const hit = findByCls(c, cls);
		if (hit) return hit;
	}
	return null;
}

function render(summary: CompletionSummary): FakeEl {
	const parent = makeFakeEl("div");
	renderCompletionSummary(parent as unknown as HTMLElement, summary);
	return parent;
}

describe("renderCompletionSummary — three-way tally", () => {
	test("completion shows synced / skipped / failed", () => {
		const parent = render({ synced: 128, skipped: 34, failed: 1 });
		const text = allText(parent);
		expect(text).toContain("128 synced");
		expect(text).toContain("34 skipped");
		expect(text).toContain("1 failed");
	});

	test("no skipped → no plan note and no skipped line", () => {
		const parent = render({ synced: 50, skipped: 0, failed: 0 });
		const text = allText(parent);
		expect(text).toContain("50 synced");
		// Zero-count segments are omitted (matches the modal's existing
		// "only show failed when > 0" convention).
		expect(text).not.toContain("skipped");
		expect(text).not.toContain("failed");
		expect(findByCls(parent, "engram-progress-plan-note")).toBeNull();
	});

	test("skipped > 0 shows the 'need a paid plan' note with an Upgrade affordance", () => {
		const parent = render({ synced: 10, skipped: 3, failed: 0 });
		const note = findByCls(parent, "engram-progress-plan-note");
		expect(note).not.toBeNull();
		const noteText = note ? allText(note) : "";
		expect(noteText.toLowerCase()).toContain("paid plan");
		expect(noteText).toContain("Sync Center");

		const upgrade = findByCls(parent, "engram-progress-upgrade");
		expect(upgrade).not.toBeNull();
		expect(upgrade?.text).toBe("Upgrade");
		// The affordance is wired to open the billing URL.
		expect(upgrade?.clickHandlers.length ?? 0).toBeGreaterThan(0);
	});

	test("skipped is singular-aware in the plan note", () => {
		const parent = render({ synced: 0, skipped: 1, failed: 0 });
		const text = allText(parent);
		expect(text).toContain("1 attachment ");
		expect(text).not.toContain("1 attachments ");
	});

	test("skipped and failed render disjointly (no double-count)", () => {
		const parent = render({ synced: 100, skipped: 5, failed: 2 });
		const text = allText(parent);
		expect(text).toContain("100 synced");
		expect(text).toContain("5 skipped");
		expect(text).toContain("2 failed");
	});
});

function plan(over: Partial<SyncPlan> = {}): SyncPlan {
	return {
		vaultName: "V",
		serverNoteCount: 0,
		serverAttachmentCount: 0,
		serverFolderCount: 0,
		localNoteCount: 0,
		localAttachmentCount: 0,
		localFolderCount: 0,
		localPaths: [],
		serverPaths: [],
		toPush: { notes: [], attachments: [] },
		toPull: { notes: [], attachments: [] },
		conflicts: [],
		toDeleteLocal: [],
		toDeleteRemote: [],
		...over,
	};
}

describe("describePlannedWork", () => {
	test("smart-merge states uploads, downloads, and the no-delete reassurance", () => {
		const p = plan({
			toPush: { notes: ["a", "b", "c"], attachments: [] },
			toPull: { notes: ["x"], attachments: [] },
		});
		expect(describePlannedWork("smart-merge", p, false)).toBe(
			"Uploading 3, downloading 1. Nothing will be deleted.",
		);
	});

	test("first sync adds an expectation-setting prefix", () => {
		const p = plan({ toPush: { notes: ["a"], attachments: [] } });
		expect(describePlannedWork("smart-merge", p, true)).toBe(
			"First sync, this may take a moment. Uploading 1. Nothing will be deleted.",
		);
	});

	test("destructive pull states the deletion instead of the no-delete line", () => {
		const p = plan({
			serverNoteCount: 2,
			toPush: { notes: ["gone.md"], attachments: [] },
		});
		expect(describePlannedWork("pull-all-delete-local", p, false)).toBe(
			"Downloading 2, deleting 1 local file.",
		);
	});

	test("nothing to do falls back to a checking message", () => {
		expect(describePlannedWork("push-all-keep-remote", plan(), false)).toBe(
			"Checking for changes.",
		);
	});
});

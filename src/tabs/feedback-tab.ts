import { Notice, Setting } from "obsidian";
import type { FeedbackCategory, FeedbackFields } from "../api";
import { t } from "../i18n";
import type { TabContext } from "./types";

// Labels are thunks over literal t() calls so the i18n key scanner sees them.
const CATEGORIES: { slug: FeedbackCategory; emoji: string; label: () => string }[] = [
	{ slug: "bug", emoji: "🐛", label: () => t("Bug") },
	{ slug: "idea", emoji: "💡", label: () => t("Idea") },
	{ slug: "confusing", emoji: "😕", label: () => t("Confusing") },
	{ slug: "love", emoji: "❤️", label: () => t("Love it") },
];

// Index + 1 is the mood score the backend stores (1-5).
const MOOD_FACES = ["😡", "🙁", "😐", "🙂", "😍"];

/** The modal's state, kept free of the DOM so it can be tested. */
export class FeedbackState {
	message = "";
	category: FeedbackCategory | null = null;
	mood: number | null = null;
	contactOk = false;
	view: "editing" | "sending" | "sent" | "error" = "editing";

	canSubmit(): boolean {
		return this.view !== "sending" && this.message.trim() !== "";
	}

	toggleCategory(slug: FeedbackCategory): void {
		this.category = this.category === slug ? null : slug;
	}

	toggleMood(score: number): void {
		this.mood = this.mood === score ? null : score;
	}

	async submit(send: (feedback: FeedbackFields) => Promise<void>): Promise<void> {
		if (!this.canSubmit()) return;
		this.view = "sending";
		try {
			await send({
				message: this.message.trim(),
				category: this.category,
				mood: this.mood,
				contactOk: this.contactOk,
			});
			this.view = "sent";
		} catch {
			// The text stays put so the user can retry without retyping.
			this.view = "error";
		}
	}
}

/** Feedback settings tab. A settings page rather than a modal: it scrolls
 *  with the mobile keyboard instead of being covered by it. Built once and
 *  updated in place, so a pressed chip or face keeps keyboard focus. */
export function renderFeedbackTab(ctx: TabContext): void {
	const { containerEl, plugin, switchToTab } = ctx;

	containerEl.createEl("p", {
		text: t("What's working, what's frustrating, what do you wish Engram did?"),
		cls: "setting-item-description",
	});

	// Sending needs an account; without one the form could only fail.
	if (!plugin.hasAuthConfigured()) {
		new Setting(containerEl)
			.setName(t("Connect to Engram first to send feedback."))
			.addButton((btn) =>
				btn
					.setButtonText(t("Open Connection"))
					.setCta()
					.onClick(() => switchToTab("connection")),
			);
		return;
	}

	const state = new FeedbackState();

	// One composer: kind on top, text in the middle, mood along the bottom
	// edge, so the form reads as a single message (mirrors the web dialog).
	const composer = containerEl.createDiv({ cls: "engram-feedback-composer" });
	const chips = composer.createDiv({
		cls: "engram-feedback-chips",
		attr: { role: "group", "aria-label": t("What kind of feedback?") },
	});
	const chipBtns = CATEGORIES.map((c) => {
		const chip = chips.createEl("button", {
			text: `${c.emoji} ${c.label()}`,
			cls: "engram-feedback-chip",
			attr: { "aria-pressed": "false" },
		});
		chip.addEventListener("click", () => {
			state.toggleCategory(c.slug);
			syncChoices();
		});
		return chip;
	});

	const textarea = composer.createEl("textarea", {
		cls: "engram-feedback-input",
		attr: {
			rows: "8",
			maxlength: "2000",
			"aria-label": t("Your feedback"),
			placeholder: t("Tell us anything"),
		},
	});
	textarea.addEventListener("input", () => {
		state.message = textarea.value;
		syncSend();
	});

	const moodRow = composer.createDiv({ cls: "engram-feedback-mood" });
	moodRow.createSpan({ text: t("How do you feel about Engram?") });
	const faces = moodRow.createDiv({
		cls: "engram-feedback-faces",
		attr: { role: "group", "aria-label": t("How do you feel about Engram?") },
	});
	const faceBtns = MOOD_FACES.map((face, i) => {
		const btn = faces.createEl("button", {
			text: face,
			cls: "engram-feedback-face clickable-icon",
			attr: { "aria-label": t("{n} of 5", { n: i + 1 }), "aria-pressed": "false" },
		});
		btn.addEventListener("click", () => {
			state.toggleMood(i + 1);
			syncChoices();
		});
		return btn;
	});

	const errorEl = containerEl.createEl("p", {
		text: t("Couldn't send your feedback, please try again."),
		cls: "mod-warning",
		attr: { role: "alert" },
	});

	const footer = containerEl.createDiv({ cls: "engram-feedback-footer" });
	const consent = footer.createEl("label", { cls: "engram-feedback-consent" });
	const box = consent.createEl("input", { type: "checkbox" });
	box.addEventListener("change", () => {
		state.contactOk = box.checked;
	});
	consent.appendText(t("It's OK to email me about this"));
	const sendBtn = footer.createEl("button", { cls: "mod-cta" });

	function syncChoices(): void {
		chipBtns.forEach((b, i) => {
			b.setAttr("aria-pressed", String(state.category === CATEGORIES[i]?.slug));
		});
		faceBtns.forEach((b, i) => {
			b.setAttr("aria-pressed", String(state.mood === i + 1));
		});
	}

	function syncSend(): void {
		sendBtn.setText(state.view === "sending" ? t("Sending…") : t("Send"));
		sendBtn.disabled = !state.canSubmit();
		errorEl.toggle(state.view === "error");
	}

	sendBtn.addEventListener("click", () => {
		const pending = state.submit((f) => plugin.api.sendFeedback(f, plugin.manifest.version));
		syncSend(); // show "Sending…"
		void pending.then(() => {
			if (state.view === "sent") {
				new Notice(t("Thanks, we read every message."));
				// Fresh form for the next one.
				Object.assign(state, new FeedbackState());
				textarea.value = "";
				box.checked = false;
				syncChoices();
			}
			syncSend();
		});
	});

	syncSend();
}

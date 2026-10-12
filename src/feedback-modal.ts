import { type App, Modal, Notice } from "obsidian";
import type { EngramApi, FeedbackCategory, FeedbackFields } from "./api";
import { t } from "./i18n";

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

/** Built once in onOpen and updated in place, so a chip or face keeps
 *  keyboard focus when pressed. */
export class FeedbackModal extends Modal {
	private readonly state = new FeedbackState();
	private sendBtn!: HTMLButtonElement;
	private errorEl!: HTMLElement;

	constructor(
		app: App,
		private readonly api: EngramApi,
		private readonly appVersion: string,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, state } = this;
		this.modalEl.addClass("engram-feedback-modal");
		this.setTitle(t("Send feedback"));

		contentEl.createEl("p", {
			text: t("What's working, what's frustrating, what do you wish Engram did?"),
			cls: "setting-item-description",
		});

		// One composer: kind on top, text in the middle, mood along the bottom
		// edge, so the form reads as a single message (mirrors the web dialog).
		const composer = contentEl.createDiv({ cls: "engram-feedback-composer" });
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
				chipBtns.forEach((b, i) => {
					b.setAttr("aria-pressed", String(state.category === CATEGORIES[i]?.slug));
				});
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
			this.sync();
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
				faceBtns.forEach((b, j) => {
					b.setAttr("aria-pressed", String(state.mood === j + 1));
				});
			});
			return btn;
		});

		this.errorEl = contentEl.createEl("p", {
			text: t("Couldn't send your feedback, please try again."),
			cls: "mod-warning",
			attr: { role: "alert" },
		});

		const footer = contentEl.createDiv({ cls: "engram-feedback-footer" });
		const consent = footer.createEl("label", { cls: "engram-feedback-consent" });
		const box = consent.createEl("input", { type: "checkbox" });
		box.addEventListener("change", () => {
			state.contactOk = box.checked;
		});
		consent.appendText(t("It's OK to email me about this"));

		this.sendBtn = footer.createEl("button", { cls: "mod-cta" });
		this.sendBtn.addEventListener("click", () => void this.send());

		this.sync();
		textarea.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Reflect the state in the Send button and the error line. */
	private sync(): void {
		const { state } = this;
		this.sendBtn.setText(state.view === "sending" ? t("Sending…") : t("Send"));
		this.sendBtn.disabled = !state.canSubmit();
		this.errorEl.toggle(state.view === "error");
	}

	private async send(): Promise<void> {
		const pending = this.state.submit((f) => this.api.sendFeedback(f, this.appVersion));
		this.sync(); // show "Sending…"
		await pending;
		if (this.state.view === "sent") {
			new Notice(t("Thanks, we read every message."));
			this.close();
		} else {
			this.sync();
		}
	}
}

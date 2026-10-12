import { type App, Modal, Notice } from "obsidian";
import type { EngramApi, FeedbackCategory, FeedbackFields } from "./api";
import { t } from "./i18n";

const CATEGORIES: { slug: FeedbackCategory; emoji: string; label: string }[] = [
	{ slug: "bug", emoji: "🐛", label: "Bug" },
	{ slug: "idea", emoji: "💡", label: "Idea" },
	{ slug: "confusing", emoji: "😕", label: "Confusing" },
	{ slug: "love", emoji: "❤️", label: "Love it" },
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

export class FeedbackModal extends Modal {
	private readonly state = new FeedbackState();

	constructor(
		app: App,
		private readonly api: EngramApi,
		private readonly appVersion: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("engram-feedback-modal");
		this.setTitle(t("Send feedback"));
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl, state } = this;
		contentEl.empty();

		contentEl.createEl("p", {
			text: t("What's working, what's frustrating, what do you wish Engram did?"),
			cls: "setting-item-description",
		});

		const chips = contentEl.createDiv({
			cls: "engram-feedback-chips",
			attr: { role: "group", "aria-label": t("What kind of feedback?") },
		});
		for (const c of CATEGORIES) {
			const chip = chips.createEl("button", {
				text: `${c.emoji} ${t(c.label)}`,
				cls: "engram-feedback-chip",
				attr: { "aria-pressed": String(state.category === c.slug) },
			});
			chip.addEventListener("click", () => {
				state.toggleCategory(c.slug);
				this.render();
			});
		}

		const textarea = contentEl.createEl("textarea", {
			cls: "engram-feedback-input",
			attr: { rows: "5", maxlength: "2000", "aria-label": t("Your feedback") },
		});
		textarea.value = state.message;

		const moodRow = contentEl.createDiv({ cls: "engram-feedback-mood" });
		moodRow.createSpan({ text: t("How do you feel about Engram?") });
		const faces = moodRow.createDiv({
			attr: { role: "group", "aria-label": t("How do you feel about Engram?") },
		});
		MOOD_FACES.forEach((face, i) => {
			const label = t("{n} of 5", { n: i + 1 });
			const btn = faces.createEl("button", {
				text: face,
				cls: "engram-feedback-face clickable-icon",
				attr: { "aria-label": label, "aria-pressed": String(state.mood === i + 1) },
			});
			btn.addEventListener("click", () => {
				state.toggleMood(i + 1);
				this.render();
			});
		});

		const consent = contentEl.createEl("label", { cls: "engram-feedback-consent" });
		const box = consent.createEl("input", { type: "checkbox" });
		box.checked = state.contactOk;
		box.addEventListener("change", () => {
			state.contactOk = box.checked;
		});
		consent.appendText(t("It's OK to email me about this"));

		if (state.view === "error") {
			contentEl.createEl("p", {
				text: t("Couldn't send your feedback, please try again."),
				cls: "mod-warning",
				attr: { role: "alert" },
			});
		}

		const footer = contentEl.createDiv({ cls: "modal-button-container" });
		const send = footer.createEl("button", {
			text: state.view === "sending" ? t("Sending…") : t("Send"),
			cls: "mod-cta",
		});
		const syncSend = () => {
			send.disabled = !state.canSubmit();
		};
		textarea.addEventListener("input", () => {
			state.message = textarea.value;
			syncSend();
		});
		syncSend();
		send.addEventListener("click", () => void this.send());

		textarea.focus();
	}

	private async send(): Promise<void> {
		const pending = this.state.submit((f) => this.api.sendFeedback(f, this.appVersion));
		this.render(); // show "Sending…"
		await pending;
		if (this.state.view === "sent") {
			new Notice(t("Thanks, we read every message."));
			this.close();
		} else {
			this.render();
		}
	}
}

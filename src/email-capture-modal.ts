// src/email-capture-modal.ts
import { type App, Modal } from "obsidian";
import { ENGRAM_GITHUB_URL, ENGRAM_MARKETING_URL } from "./tabs/urls";
import { submitWaitlistEmail } from "./waitlist";

/** Pragmatic email shape check: one @, a dot in the domain, no spaces. Mirrors
 *  the server's lenient validation; the server is the source of truth. */
export function isLikelyEmail(s: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export type EmailCaptureView = "form" | "submitting" | "success" | "error";

/** Pure, testable state for EmailCaptureModal. The Modal class is a thin DOM
 *  wrapper that delegates to this. */
export class EmailCaptureState {
	view: EmailCaptureView = "form";
	email = "";
	errorText: string | null = null;

	setEmail(v: string): void {
		this.email = v;
		if (this.view === "error") {
			this.view = "form";
			this.errorText = null;
		}
	}

	canSubmit(): boolean {
		return (this.view === "form" || this.view === "error") && isLikelyEmail(this.email);
	}

	async submit(send: (email: string) => Promise<void>): Promise<void> {
		if (!this.canSubmit()) return;
		this.view = "submitting";
		this.errorText = null;
		try {
			await send(this.email.trim());
			this.view = "success";
		} catch {
			this.view = "error";
			this.errorText = "Couldn't reach the server. Try again later.";
		}
	}
}

export interface EmailCaptureFormOptions {
	/** Element to render the input + footer into. */
	parent: HTMLElement;
	/** Shared capture state. */
	state: EmailCaptureState;
	/** Redraw the surrounding container after a state change. */
	rerender: () => void;
	/** Submit transport — injectable for tests; defaults to the real POST. */
	send?: (email: string) => Promise<void>;
	/** Append extra controls to the footer (e.g. the modal's "Maybe later"). */
	decorateFooter?: (footer: HTMLElement) => void;
}

/** Render the email input + submit button and wire up validation/submit. Shared
 *  by the first-run modal and the Welcome-tab inline form so both surfaces have
 *  identical behavior (focus handling, disabled states, error display). */
export function renderEmailCaptureForm({
	parent,
	state,
	rerender,
	send = submitWaitlistEmail,
	decorateFooter,
}: EmailCaptureFormOptions): void {
	const input = parent.createEl("input", {
		type: "email",
		placeholder: "you@example.com",
		cls: "engram-email-capture-input",
	});
	input.value = state.email;
	input.disabled = state.view === "submitting";

	if (state.errorText) {
		parent.createEl("p", { text: state.errorText, cls: "engram-email-capture-error" });
	}

	const footer = parent.createDiv({ cls: "engram-email-capture-footer" });
	const submit = footer.createEl("button", {
		text: state.view === "submitting" ? "Submitting…" : "Notify me",
		cls: "mod-cta",
	});
	submit.disabled = state.view === "submitting";
	decorateFooter?.(footer);

	const doSubmit = async (): Promise<void> => {
		state.setEmail(input.value);
		if (!state.canSubmit()) {
			state.view = "error";
			state.errorText = "Please enter a valid email address.";
			rerender();
			return;
		}
		await state.submit(send);
		rerender();
	};

	input.addEventListener("input", () => state.setEmail(input.value));
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") void doSubmit();
	});
	submit.addEventListener("click", () => void doSubmit());

	input.focus();
}

export class EmailCaptureModal extends Modal {
	private state = new EmailCaptureState();
	private done = false;

	constructor(
		app: App,
		private readonly onDone: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("engram-email-capture-modal");
		this.render();
	}

	onClose(): void {
		// Esc / backdrop / explicit close all count as "seen" → fire once.
		this.contentEl.empty();
		this.finish();
	}

	private finish(): void {
		if (this.done) return;
		this.done = true;
		this.onDone();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		if (this.state.view === "success") {
			contentEl.createEl("h2", { text: "You're on the list. Thanks for your patience! 🎉" });
			const close = contentEl.createEl("button", { text: "Close", cls: "mod-cta" });
			close.addEventListener("click", () => this.close());
			return;
		}

		contentEl.createEl("h2", { text: "You're early. Engram isn't ready yet." });
		contentEl.createEl("p", {
			text:
				"We're building Engram in the open, and early people like you make it better. " +
				"Leave your email for beta access, an early-supporter discount, and a standing " +
				"invite to give feedback and steer what comes next.",
		});
		const contact = contentEl.createEl("p", {
			cls: "engram-email-capture-contact",
			text: "Questions or feedback? Email me directly at ",
		});
		contact.createEl("a", { text: "todd@engram.page", href: "mailto:todd@engram.page" });

		const links = contentEl.createEl("p", { cls: "engram-email-capture-links" });
		links.createEl("a", {
			text: "engram.page",
			href: ENGRAM_MARKETING_URL,
			attr: { target: "_blank", rel: "noopener" },
		});
		links.createSpan({ text: " · " });
		links.createEl("a", {
			text: "GitHub",
			href: ENGRAM_GITHUB_URL,
			attr: { target: "_blank", rel: "noopener" },
		});

		renderEmailCaptureForm({
			parent: contentEl,
			state: this.state,
			rerender: () => this.render(),
			decorateFooter: (footer) => {
				const later = footer.createEl("button", { text: "Maybe later" });
				later.addEventListener("click", () => this.close());
			},
		});
	}
}

// src/report-issue-modal.ts
import { type App, Modal } from "obsidian";
import type { EngramApi } from "./api";

export class ReportIssueState {
	description = "";
	view: "editing" | "submitting" | "success" | "error" = "editing";
	errorText = "";

	setDescription(value: string): void {
		this.description = value;
	}

	canSubmit(): boolean {
		return this.view !== "submitting" && this.description.trim().length > 0;
	}

	async submit(send: (description: string) => Promise<void>): Promise<void> {
		if (!this.canSubmit()) return;
		this.view = "submitting";
		try {
			await send(this.description.trim());
			this.view = "success";
		} catch {
			this.view = "error";
			this.errorText = "Couldn't send your report. Try again later.";
		}
	}
}

export class ReportIssueModal extends Modal {
	private state = new ReportIssueState();

	constructor(
		app: App,
		private readonly api: EngramApi,
		private readonly appVersion: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("engram-report-issue-modal");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		if (this.state.view === "success") {
			contentEl.createEl("p", { text: "Thanks. Your report was sent." });
			const close = contentEl.createEl("button", { text: "Close", cls: "mod-cta" });
			close.addEventListener("click", () => this.close());
			return;
		}

		contentEl.createEl("h3", { text: "Report an issue" });
		contentEl.createEl("p", {
			text: "Describe what went wrong. We attach your account and a time window so we can pull the logs.",
		});

		const textarea = contentEl.createEl("textarea", {
			cls: "engram-report-issue-input",
			attr: { rows: "6", placeholder: "What happened?" },
		});
		textarea.value = this.state.description;
		textarea.addEventListener("input", () => this.state.setDescription(textarea.value));

		if (this.state.view === "error") {
			contentEl.createEl("p", {
				text: this.state.errorText,
				cls: "engram-report-issue-error",
			});
		}

		const footer = contentEl.createDiv({ cls: "engram-report-issue-footer" });
		const submit = footer.createEl("button", {
			text: this.state.view === "submitting" ? "Sending..." : "Send report",
			cls: "mod-cta",
		});
		submit.disabled = this.state.view === "submitting";
		submit.addEventListener("click", () => void this.doSubmit());
		textarea.focus();
	}

	private async doSubmit(): Promise<void> {
		await this.state.submit((description) =>
			this.api.reportIssue(description, this.appVersion),
		);
		this.render();
	}
}

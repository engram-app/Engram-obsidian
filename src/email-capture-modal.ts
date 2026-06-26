// src/email-capture-modal.ts
import { type App, Modal } from "obsidian";

/** Pragmatic email shape check — one @, a dot in the domain, no spaces. Mirrors
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
			this.errorText = "Couldn't reach the server — try again later.";
		}
	}
}

// EmailCaptureModal (Task 2.3) will be appended below, extending Modal.
// The App type and Modal class are already imported above for that use.

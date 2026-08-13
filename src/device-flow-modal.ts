import { type App, Modal, Notice, requestUrl } from "obsidian";
import { EngramApi, withTimeout } from "./api";
import { devLog } from "./dev-log";
import { errMsg } from "./error-util";
import type EngramSyncPlugin from "./main";

export interface DeviceFlowResult {
	access_token: string;
	refresh_token: string;
	vault_id: string;
	user_email: string;
	expires_in: number;
}

export class DeviceFlowModal extends Modal {
	private plugin: EngramSyncPlugin;
	private resolve: (result: DeviceFlowResult | null) => void = () => {};
	private pollInterval: number | null = null;
	private aborted = false;

	constructor(app: App, plugin: EngramSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Link Obsidian to Engram" });
		const statusEl = contentEl.createEl("p", { text: "Starting..." });

		void this.beginDeviceFlow(contentEl, statusEl);
	}

	private async beginDeviceFlow(contentEl: HTMLElement, statusEl: HTMLElement): Promise<void> {
		try {
			const resp = await this.startDeviceFlow();
			this.renderCodeScreen(contentEl, resp);
			this.startPolling(resp.device_code);
		} catch {
			statusEl.setText("Failed to start device flow. Check your Engram URL and try again.");
		}
	}

	onClose(): void {
		this.aborted = true;
		if (this.pollInterval) {
			window.clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
		this.contentEl.empty();
		this.resolve(null);
	}

	waitForResult(): Promise<DeviceFlowResult | null> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	private async startDeviceFlow(): Promise<{
		device_code: string;
		user_code: string;
		verification_url: string;
		expires_in: number;
	}> {
		const apiUrl = EngramApi.normalizeBaseUrl(this.plugin.settings.apiUrl);
		// Trim before sending so we don't ship trailing whitespace from a
		// corrupted Obsidian config; omit the field entirely when empty so the
		// backend doesn't store a useless empty hint. (Backend also clamps the
		// value, but normalizing client-side keeps logs and DB rows clean.)
		const vaultName = this.app.vault.getName().trim();
		const body: { client_id: string; vault_name?: string } = {
			client_id: this.plugin.settings.clientId,
		};
		if (vaultName) body.vault_name = vaultName;
		const resp = await withTimeout(
			requestUrl({
				url: `${apiUrl}/auth/device`,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				throw: false,
			}),
			15_000,
		);
		if (resp.status < 200 || resp.status >= 300) {
			throw new Error(`HTTP ${resp.status}`);
		}
		return resp.json as {
			device_code: string;
			user_code: string;
			verification_url: string;
			expires_in: number;
		};
	}

	private renderCodeScreen(
		contentEl: HTMLElement,
		resp: { user_code: string; verification_url: string },
	): void {
		contentEl.empty();
		contentEl.createEl("h2", { text: "Link Obsidian to Engram" });
		contentEl.createEl("p", { text: "Your code:" });

		const codeEl = contentEl.createEl("code", {
			text: resp.user_code,
			cls: "engram-device-code",
		});
		codeEl.title = "Click to copy";
		codeEl.addEventListener("click", () => {
			void navigator.clipboard.writeText(resp.user_code);
			new Notice("Code copied!");
		});

		contentEl.createEl("p", {
			text: "A browser window has opened. Sign in and enter this code to link your vault.",
		});

		contentEl.createEl("p", {
			text: "Waiting for authorization...",
			cls: "engram-device-waiting",
		});

		const btnContainer = contentEl.createDiv({ cls: "engram-device-buttons" });
		const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		window.open(resp.verification_url);
	}

	private startPolling(deviceCode: string): void {
		const apiUrl = EngramApi.normalizeBaseUrl(this.plugin.settings.apiUrl);
		// Wall-clock deadline, not a tick counter: a 15s-timeout request holding
		// its 5s tick hostage made `elapsed += 5` undercount real time.
		const startedAt = Date.now();
		const maxSeconds = 300;
		// One request at a time: the interval fires regardless of whether the
		// previous poll (up to 15s) is still in flight, which stacked up to three
		// concurrent token requests.
		let inFlight = false;

		const poll = async (): Promise<void> => {
			if (this.aborted || inFlight) return;
			inFlight = true;
			try {
				await this.pollOnce(apiUrl, deviceCode, startedAt, maxSeconds);
			} finally {
				inFlight = false;
			}
		};

		this.pollInterval = window.setInterval(() => {
			void poll();
		}, 5000);
	}

	private async pollOnce(
		apiUrl: string,
		deviceCode: string,
		startedAt: number,
		maxSeconds: number,
	): Promise<void> {
		if ((Date.now() - startedAt) / 1000 >= maxSeconds) {
			if (this.pollInterval) window.clearInterval(this.pollInterval);
			this.renderExpired();
			return;
		}

		try {
			const resp = await withTimeout(
				requestUrl({
					url: `${apiUrl}/auth/device/token`,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ device_code: deviceCode }),
					throw: false,
				}),
				15_000,
			);

			// Still waiting for the human to approve. 400 is the RFC 8628 §3.5
			// status (engram#device-auth); 428 is what this endpoint returned
			// before 2026-08 and is kept so an older backend still links.
			// Unrecognised statuses also fall through to "keep polling" below —
			// that is what made the server-side flip safe for already-installed
			// builds, but it is implicit, so name the pending statuses here.
			if (resp.status === 400 || resp.status === 428) return;

			if (resp.status >= 200 && resp.status < 300) {
				if (this.pollInterval) window.clearInterval(this.pollInterval);
				const result = resp.json as DeviceFlowResult;
				this.resolve(result);
				this.resolve = () => {};
				this.close();
				return;
			}

			if (resp.status === 410) {
				if (this.pollInterval) window.clearInterval(this.pollInterval);
				this.renderExpired();
				return;
			}
		} catch (e) {
			// Network error / timeout: keep polling, but leave a debug trace so a
			// systematically failing endpoint is visible instead of silent.
			devLog().log("device-flow", `poll failed: ${errMsg(e)}`);
		}
	}

	private renderExpired(): void {
		const contentEl = this.contentEl;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Link Obsidian to Engram" });
		contentEl.createEl("p", { text: "Code expired. Please try again." });

		const btnContainer = contentEl.createDiv({ cls: "engram-device-buttons" });

		const retryBtn = btnContainer.createEl("button", { text: "Try again", cls: "mod-cta" });
		retryBtn.addEventListener("click", () => {
			this.aborted = false;
			void this.onOpen();
		});

		const closeBtn = btnContainer.createEl("button", { text: "Close" });
		closeBtn.addEventListener("click", () => this.close());
	}
}

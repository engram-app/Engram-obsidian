import { type App, Modal, Notice, requestUrl } from "obsidian";
import { EngramApi, withTimeout } from "./api";
import { devLog } from "./dev-log";
import { waitForDeviceAuthorization } from "./device-flow-socket";
import { errMsg } from "./error-util";
import type EngramSyncPlugin from "./main";

export interface DeviceFlowResult {
	access_token: string;
	refresh_token: string;
	vault_id: string;
	user_email: string;
	expires_in: number;
}

// RFC 8628 §3.3.1 `verification_uri_complete`: hand the browser the code so
// /link prefills (and auto-verifies) instead of making the user retype what
// the plugin already knows. The backend returns the bare page URL, so the
// plugin — which holds both halves — is where they get joined.
// Safe to put in the URL: authorizing still requires a signed-in user to pick
// a vault and click Sync, and the page scrubs the param out of history on
// arrival. Falls back to the bare URL if the backend ever sends a non-URL.
export function verificationUrlWithCode(verificationUrl: string, userCode: string): string {
	try {
		const url = new URL(verificationUrl);
		url.searchParams.set("code", userCode);
		return url.toString();
	} catch {
		return verificationUrl;
	}
}

export class DeviceFlowModal extends Modal {
	private plugin: EngramSyncPlugin;
	private resolve: (result: DeviceFlowResult | null) => void = () => {};
	private pollInterval: number | null = null;
	private disposeSocket: (() => void) | null = null;
	private exchanging = false;
	/** Socket said "authorized" while an exchange was already in flight. */
	private pendingAuthorized = false;
	private waitingEl: HTMLElement | null = null;
	private aborted = false;

	constructor(app: App, plugin: EngramSyncPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl } = this;
		// Shared sizing with the preview + progress modals — this is step one of
		// one task, so the window must not change shape between steps.
		contentEl.addClass("engram-flow-modal");
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

	/** Tear down everything belonging to ONE attempt at the flow.
	 *
	 *  Both exits need this. Close is the obvious one; "Try again" is the one
	 *  that bit: it re-ran onOpen(), and startPolling() then OVERWROTE
	 *  disposeSocket and pollInterval, leaking the previous socket and its
	 *  heartbeat for the rest of the Obsidian session. Worse, the orphan's
	 *  onAuthorized closure still held the OLD device_code and could take
	 *  `exchanging`, blocking the retry the user is standing there watching. */
	private resetFlow(): void {
		if (this.pollInterval) {
			window.clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
		this.disposeSocket?.();
		this.disposeSocket = null;
		this.exchanging = false;
		this.pendingAuthorized = false;
	}

	onClose(): void {
		this.aborted = true;
		this.resetFlow();
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

		// Text is set by setWaitingStatus once the socket reports in. Starts
		// pessimistic: until the join is acked we are genuinely on the poll.
		this.waitingEl = contentEl.createEl("p", { cls: "engram-device-waiting" });
		this.setWaitingStatus(false);

		const btnContainer = contentEl.createDiv({ cls: "engram-device-buttons" });
		const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		window.open(verificationUrlWithCode(resp.verification_url, resp.user_code));
	}

	/** Say which path we are actually on. Without this, "the socket isn't
	 *  working" and "the socket is working" look identical from the outside
	 *  until you time the flow with a stopwatch. */
	private setWaitingStatus(live: boolean): void {
		if (!this.waitingEl) return;
		this.waitingEl.setText(
			live
				? "Waiting for authorization — connected, this will complete instantly."
				: "Waiting for authorization — no live connection, checking every 30s.",
		);
	}

	private startPolling(deviceCode: string): void {
		const apiUrl = EngramApi.normalizeBaseUrl(this.plugin.settings.apiUrl);

		// Primary path: the server tells us the instant the browser authorizes,
		// so completion is immediate instead of landing somewhere in a 5s
		// window. The interval below is now only a fallback for networks that
		// block WebSockets — see waitForDeviceAuthorization.
		this.disposeSocket = waitForDeviceAuthorization(
			apiUrl,
			deviceCode,
			() => {
				void this.exchangeNow(apiUrl, deviceCode);
			},
			{ onStatus: (live) => this.setWaitingStatus(live) },
		);

		// Wall-clock deadline, not a tick counter: a 15s-timeout request holding
		// its 5s tick hostage made `elapsed += 5` undercount real time.
		const startedAt = Date.now();
		const maxSeconds = 300;
		// One request at a time: the interval fires regardless of whether the
		// previous poll (up to 15s) is still in flight, which stacked up to three
		// concurrent token requests.
		//
		// Deliberately `this.exchanging` and not a local flag — the socket path
		// redeems the same single-use code, so the two must share one guard or
		// the loser of that race renders "expired" over a successful link.
		const poll = async (): Promise<void> => {
			if (this.aborted || this.exchanging) return;
			this.exchanging = true;
			try {
				await this.pollOnce(apiUrl, deviceCode, startedAt, maxSeconds);
			} finally {
				this.exchanging = false;
			}
			await this.drainPendingAuthorized(apiUrl, deviceCode);
		};

		// 30s, not 5s. This is no longer how the flow completes — the socket is —
		// so it exists purely to rescue a user whose network blocks WebSockets.
		// Tightening it would just add request volume to the common path where
		// it never wins the race.
		// registerInterval + register so a plugin unload (update, disable) takes
		// the fallback timer AND the socket with it. A Modal is not a child of
		// the plugin's component tree, so nothing else would.
		this.pollInterval = this.plugin.registerInterval(
			window.setInterval(() => {
				void poll();
			}, 30_000),
		);
		this.plugin.register(() => this.resetFlow());
	}

	/** Socket said the code was authorized: exchange it once, right now.
	 *
	 *  Guarded because the fallback interval is still armed — without this a
	 *  poll already in flight and the socket-triggered exchange could both
	 *  redeem, and the loser would see the 410 from a single-use code and
	 *  render "expired" over a flow that actually succeeded. */
	private async exchangeNow(apiUrl: string, deviceCode: string): Promise<void> {
		if (this.aborted) return;
		if (this.exchanging) {
			// Don't drop the notification. The in-flight request is very likely a
			// fallback poll that STARTED before the user authorized, so it will
			// come back 400 "still waiting" — and without this the live path's
			// whole benefit is lost to the next 30s tick.
			this.pendingAuthorized = true;
			return;
		}
		this.exchanging = true;
		try {
			await this.pollOnce(apiUrl, deviceCode, Date.now(), 300);
		} finally {
			this.exchanging = false;
		}
		await this.drainPendingAuthorized(apiUrl, deviceCode);
	}

	/** Re-run an exchange that arrived while the lock was held. Bounded: the
	 *  flag is only ever set while `exchanging` is true, and cleared before the
	 *  retry, so this cannot loop. */
	private async drainPendingAuthorized(apiUrl: string, deviceCode: string): Promise<void> {
		if (!this.pendingAuthorized || this.aborted) return;
		this.pendingAuthorized = false;
		await this.exchangeNow(apiUrl, deviceCode);
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
				this.disposeSocket?.();
				this.disposeSocket = null;
				const result = resp.json as DeviceFlowResult;
				this.resolve(result);
				this.resolve = () => {};
				// Close and get out of the way. The caller persists the tokens and
				// goes straight into the first-sync preview — a step that confirms
				// "yes it connected" and then makes you click again is a speed bump,
				// and the sync preview already names what happens next.
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
			// Kill the expired attempt's socket and interval BEFORE onOpen()
			// starts a fresh set — see resetFlow.
			this.resetFlow();
			this.aborted = false;
			this.onOpen();
		});

		const closeBtn = btnContainer.createEl("button", { text: "Close" });
		closeBtn.addEventListener("click", () => this.close());
	}
}

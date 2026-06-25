import type { AuthProvider } from "./auth";
import { errMsg } from "./error-util";
import { rlog } from "./remote-log";

/** How long to wait before reconnecting when no auth token is available
 *  (e.g. plugin loaded before OAuth refresh hydrated, or user signed out).
 *  Long enough to avoid console spam, short enough that re-auth catches up
 *  within a reasonable user-perceived window. */
const NO_AUTH_RECONNECT_MS = 30_000;

/** If a WS close lands within this window after open, treat it as a probable
 *  auth-failure handshake reject (Phoenix's UserSocket returns 403 at upgrade
 *  for expired/invalid JWTs, manifesting client-side as an immediate close
 *  rather than an HTTP status). We invalidate the cached access token so the
 *  next reconnect forces a refresh. Wider than any legitimate network blip,
 *  narrower than a real session.
 */
const AUTH_FAIL_WINDOW_MS = 5_000;
/**
 * Phoenix Channel client for Engram real-time sync.
 *
 * Uses the Phoenix v2 WebSocket wire protocol natively — no phoenix npm
 * package needed.
 *
 * Protocol: messages are JSON arrays [join_ref, ref, topic, event, payload]
 */
import type { NoteStreamEvent } from "./types";

export class NoteChannel {
	private ws: WebSocket | null = null;
	private ref = 0;
	private readonly joinRef = "1";
	private readonly userJoinRef = "2";
	private readonly crdtJoinRef = "3";
	private heartbeatTimer: number | null = null;
	private reconnectTimer: number | null = null;
	private reconnectMs = 1000;
	private readonly maxReconnectMs = 60_000;
	private connected = false;
	private baseUrl: string;
	private apiKey: string;
	private userId: string;
	private vaultId: string | null;
	private authProvider: AuthProvider | null = null;

	onEvent: ((event: NoteStreamEvent) => void) | null = null;
	onStatusChange: ((connected: boolean) => void) | null = null;
	onVaultDeleted: (() => void) | null = null;
	/** Surfaces the user's current plan/entitlements from the best-effort
	 *  `user:{userId}` topic (join reply `response.plan` + `subscription_activated`
	 *  broadcasts). Never gates the plugin's connected state. */
	onPlanState: ((plan: unknown) => void) | null = null;
	/** Inbound CRDT frames from the server. `docId` is the full vault-scoped id. */
	onCrdtMessage: ((docId: string, b64: string) => void) | null = null;

	constructor(baseUrl: string, apiKey: string, userId: string, vaultId: string | null = null) {
		this.baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/api$/, "");
		this.apiKey = apiKey;
		this.userId = userId;
		this.vaultId = vaultId;
		rlog().info(
			"channel",
			`NoteChannel ctor — userId=${userId} vaultId=${vaultId ?? "null"} apiKeyLen=${apiKey.length} baseUrl=${this.baseUrl}`,
		);
	}

	setAuthProvider(provider: AuthProvider): void {
		this.authProvider = provider;
		rlog().info("channel", `setAuthProvider — type=${provider.constructor.name}`);
	}

	private async getAuthToken(): Promise<{ token: string; source: string }> {
		if (this.authProvider) {
			const token = await this.authProvider.getToken();
			return { token, source: this.authProvider.constructor.name };
		}
		return { token: this.apiKey, source: "apiKey-fallback" };
	}

	updateConfig(
		baseUrl: string,
		apiKey: string,
		userId: string,
		vaultId: string | null = null,
	): void {
		this.baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/api$/, "");
		this.apiKey = apiKey;
		this.userId = userId;
		this.vaultId = vaultId;
	}

	private get topic(): string {
		return this.vaultId ? `sync:${this.userId}:${this.vaultId}` : `sync:${this.userId}`;
	}

	private get userTopic(): string {
		return `user:${this.userId}`;
	}

	private get crdtTopic(): string | null {
		return this.vaultId ? `crdt:${this.userId}:${this.vaultId}` : null;
	}

	/** Send a CRDT update frame to the server on the crdt topic.
	 *  No-op when vaultId is null (crdt topic not joined). */
	sendCrdt(docId: string, b64: string): void {
		const t = this.crdtTopic;
		if (!t) return;
		this.send([null, String(++this.ref), t, "crdt_msg", { doc_id: docId, b64 }]);
	}

	async connect(): Promise<void> {
		if (this.ws) return;
		this.reconnectMs = 1000;
		await this.openSocket();
	}

	disconnect(): void {
		this.clearTimers();
		if (this.ws) {
			this.ws.onclose = null; // prevent reconnect on intentional close
			this.ws.close();
			this.ws = null;
		}
		this.setConnected(false);
		rlog().info("channel", "Channel disconnected");
	}

	isConnected(): boolean {
		return this.connected;
	}

	// ---------------------------------------------------------------------------
	// Private
	// ---------------------------------------------------------------------------

	private async openSocket(): Promise<void> {
		let token: string;
		let source: string;
		try {
			const result = await this.getAuthToken();
			token = result.token;
			source = result.source;
		} catch (e) {
			rlog().warn(
				"channel",
				`getToken threw — deferring reconnect ${NO_AUTH_RECONNECT_MS}ms — providerType=${this.authProvider?.constructor.name ?? "none"} err=${errMsg(e)}`,
			);
			this.scheduleReconnect(NO_AUTH_RECONNECT_MS);
			return;
		}

		// Empty token would cause the server to reject the upgrade and we'd
		// loop on close → reconnect → empty token → ... forever, spamming the
		// console. Defer with a long backoff until auth is hydrated.
		if (!token) {
			rlog().warn(
				"channel",
				`Empty token — skip WS connect, defer ${NO_AUTH_RECONNECT_MS}ms — source=${source} hasProvider=${!!this.authProvider} providerType=${this.authProvider?.constructor.name ?? "none"} apiKeyLen=${this.apiKey.length}`,
			);
			this.scheduleReconnect(NO_AUTH_RECONNECT_MS);
			return;
		}

		rlog().info(
			"channel",
			`openSocket — token.length=${token.length} source=${source} userId=${this.userId} vaultId=${this.vaultId ?? "null"}`,
		);

		const wsBase = this.baseUrl.replace(/^http/, "ws").replace(/^https/, "wss");
		const url = `${wsBase}/socket/websocket?token=${encodeURIComponent(token)}&vsn=2.0.0`;

		const openedAt = Date.now();
		let opened = false;

		try {
			this.ws = new WebSocket(url);
		} catch (e) {
			rlog().error("channel", `WebSocket open error: ${errMsg(e)}`);
			this.scheduleReconnect();
			return;
		}

		this.ws.onopen = () => {
			opened = true;
			this.reconnectMs = 1000;
			this.joinChannel();
			this.startHeartbeat();
			rlog().info("channel", "WebSocket opened, joining channel");
		};

		this.ws.onmessage = (evt: MessageEvent) => {
			this.handleMessage(evt.data as string);
		};

		this.ws.onerror = (e) => {
			rlog().error("channel", `WebSocket error: ${JSON.stringify(e)}`);
		};

		this.ws.onclose = () => {
			this.clearTimers();
			this.ws = null;
			this.setConnected(false);

			// Phoenix UserSocket rejects expired/invalid JWTs at the WS upgrade,
			// which the browser surfaces as an immediate close without ever
			// firing `onopen`. Treat any close that lands inside the fail window
			// without a successful open as an auth handshake reject and force
			// the next reconnect to mint a fresh access token. (A real network
			// blip won't fire onclose without an onopen — the WebSocket would
			// stay in CONNECTING and eventually error out instead.)
			const sinceOpen = Date.now() - openedAt;
			if (
				!opened &&
				sinceOpen < AUTH_FAIL_WINDOW_MS &&
				this.authProvider?.invalidateAccessToken
			) {
				rlog().warn(
					"channel",
					`WS closed before open at ${sinceOpen}ms — assuming stale access token, invalidating`,
				);
				this.authProvider.invalidateAccessToken();
			}

			rlog().info("channel", `Channel closed, reconnecting in ${this.reconnectMs}ms`);
			this.scheduleReconnect();
		};
	}

	private joinChannel(): void {
		this.send([this.joinRef, String(++this.ref), this.topic, "phx_join", {}]);
		// Best-effort: join the per-user topic to receive plan/entitlement state.
		// Uses a distinct join ref so replies are attributable, and an older
		// backend that doesn't serve this topic simply replies with an error
		// (handled below) without affecting the sync channel.
		this.send([this.userJoinRef, String(++this.ref), this.userTopic, "phx_join", {}]);
		// Best-effort: join the CRDT topic for real-time CRDT frame exchange.
		// Only joined when vaultId is known; a backend that doesn't serve this
		// topic replies with an error (handled gracefully below).
		const crdtT = this.crdtTopic;
		if (crdtT) {
			this.send([this.crdtJoinRef, String(++this.ref), crdtT, "phx_join", {}]);
		}
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = window.setInterval(() => {
			if (this.ws?.readyState === WebSocket.OPEN) {
				this.send([null, String(++this.ref), "phoenix", "heartbeat", {}]);
			}
		}, 30_000);
	}

	private handleMessage(raw: string): void {
		let msg: unknown[];
		try {
			msg = JSON.parse(raw) as unknown[];
		} catch {
			rlog().error("channel", `Failed to parse message: ${raw}`);
			return;
		}

		const [, , topic, event, payload] = msg as [
			string | null,
			string | null,
			string,
			string,
			Record<string, unknown>,
		];

		if (event === "phx_reply") {
			const status = (payload as { status?: string }).status;
			if (status === "ok") {
				// The plugin's connected state is keyed ONLY on the sync topic.
				// The user topic is best-effort and must never flip connected.
				if (topic === this.topic && !this.connected) {
					this.setConnected(true);
					rlog().info("channel", `Joined ${this.topic}`);
				} else if (topic === this.userTopic) {
					const response = (payload as { response?: { plan?: unknown } }).response;
					const plan = response?.plan;
					if (plan !== undefined && plan !== null) {
						rlog().info("channel", `Joined ${this.userTopic} — plan state received`);
						this.onPlanState?.(plan);
					}
				}
			} else if (status === "error") {
				// Include the topic so a best-effort user-topic join failure
				// (e.g. an older backend) is distinguishable from a sync failure.
				// Either way we do NOT touch sync connection state here.
				rlog().error(
					"channel",
					`Channel join error on ${topic}: ${JSON.stringify(payload)}`,
				);
			}
			return;
		}

		if (event === "subscription_activated" && topic === this.userTopic) {
			rlog().info("channel", "Received subscription_activated event");
			this.onPlanState?.(payload);
			return;
		}

		if (event === "vault_deleted") {
			rlog().info("channel", "Received vault_deleted event");
			this.onVaultDeleted?.();
			return;
		}

		if (event === "crdt_msg" && payload) {
			const docId = payload.doc_id as string | undefined;
			const b64 = payload.b64 as string | undefined;
			if (docId && b64) {
				this.onCrdtMessage?.(docId, b64);
			}
			return;
		}

		if (event === "note_changed" && payload) {
			const p = payload;
			const streamEvent: NoteStreamEvent = {
				event_type: p.event_type as "upsert" | "delete",
				path: p.path as string,
				timestamp: Date.now(),
				kind: (p.kind as "note" | "attachment") ?? "note",
				content: p.content as string | undefined,
				content_hash: p.content_hash as string | undefined,
				title: p.title as string | undefined,
				folder: p.folder as string | undefined,
				tags: p.tags as string[] | undefined,
				mtime: p.mtime as number | undefined,
				updated_at: p.updated_at as string | undefined,
				version: p.version as number | undefined,
			};
			rlog().info("channel", `Event: ${streamEvent.event_type} ${streamEvent.path}`);
			this.onEvent?.(streamEvent);
		}

		// Protocol rev: bulk pushes broadcast ONE notes.batch digest
		// (op "upsert", metadata-only entries) instead of N note_changed
		// events. Translate each entry to a hash-only stream event — the
		// engine's hash-compare decides per path whether to fetch the body.
		if (event === "notes.batch" && payload && payload.op === "upsert") {
			const notes = (payload.notes as Array<Record<string, unknown>> | undefined) ?? [];
			rlog().info("channel", `Batch digest: ${notes.length} notes`);
			for (const n of notes) {
				const streamEvent: NoteStreamEvent = {
					event_type: "upsert",
					path: n.path as string,
					timestamp: Date.now(),
					kind: "note",
					content_hash: n.content_hash as string | undefined,
					title: n.title as string | undefined,
					folder: n.folder as string | undefined,
					tags: n.tags as string[] | undefined,
					mtime: n.mtime as number | undefined,
					updated_at: n.updated_at as string | undefined,
					version: n.version as number | undefined,
				};
				this.onEvent?.(streamEvent);
			}
		}
	}

	private send(msg: unknown[]): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}

	private setConnected(value: boolean): void {
		if (this.connected !== value) {
			this.connected = value;
			this.onStatusChange?.(value);
		}
	}

	private clearTimers(): void {
		if (this.heartbeatTimer) {
			window.clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
		if (this.reconnectTimer) {
			window.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	private scheduleReconnect(overrideMs?: number): void {
		const base = overrideMs ?? this.reconnectMs;
		const jitter = Math.random() * base * 0.5;
		this.reconnectTimer = window.setTimeout(() => {
			if (overrideMs === undefined) {
				this.reconnectMs = Math.min(this.reconnectMs * 2, this.maxReconnectMs);
			}
			void this.openSocket();
		}, base + jitter);
	}
}

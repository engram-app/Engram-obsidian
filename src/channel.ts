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

/** Full-jitter reconnect window (ms) for the FIRST reconnect after a live
 *  connection drops (e.g. graceful server drain). Spreads a drained fleet's
 *  reconnects over random(0, window) so the freshly-booted node isn't
 *  stampeded. Overridden per-connection by the server-advertised value from
 *  the sync join reply; this constant is the crash-safe floor. */
export const RECONNECT_JITTER_DEFAULT_MS = 5_000;
/** Hard ceiling on any server-advertised jitter window — guards against a
 *  malformed/hostile join reply making the client hang. Non-positive windows
 *  (including zero) are rejected, forcing the client to fall back to the default
 *  floor rather than silently disabling jitter. */
export const RECONNECT_JITTER_MAX_MS = 60_000;

export function clampReconnectJitter(raw: unknown): number | null {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
	return Math.min(raw, RECONNECT_JITTER_MAX_MS);
}

export function fullJitterDelay(windowMs: number, rng: () => number = Math.random): number {
	return rng() * windowMs;
}

/** Warn threshold for an outbound frame's serialized size, in bytes (JSON string
 *  length is used as a fine proxy for actual byte size). Bandit's default
 *  transport `max_frame_size` is ~8 MB - a frame anywhere near that limit gets
 *  the WHOLE socket 1009-killed by the server, not just the oversize message
 *  rejected (see docs/context/ws-zombie-channel-diagnosis.md). 1 MB gives
 *  plenty of runway to catch a growing note/attachment before it gets close. */
const LARGE_FRAME_WARN_BYTES = 1_000_000;

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
	private pendingHeartbeatRef: string | null = null;
	private reconnectTimer: number | null = null;
	private reconnectMs = 1000;
	private readonly maxReconnectMs = 60_000;
	private reconnectJitterMaxMs: number | null = null;
	private connected = false;
	/** True only when the `crdt:` topic join has been acknowledged by the server.
	 *  Reset on every disconnect so it re-gates on the next connection. A backend
	 *  that does not serve the crdt: topic replies with an error (handled below),
	 *  keeping this false — which allows the legacy pushNote path to remain active. */
	private crdtJoined = false;
	/**
	 * The `ref` value sent with the crdt: topic phx_join frame.
	 * Stored so handleMessage can distinguish a join-error reply (ref matches)
	 * from a per-message error reply such as "rate_limited" or "frame_too_large"
	 * on a crdt_msg (ref does NOT match). Only the join-error reply should fire
	 * onCrdtJoinError and tear down the CRDT session; per-message errors are
	 * transient and must not degrade the transport.
	 * Reset to null on every joinChannel() call (each (re)connect issues a new join).
	 */
	private crdtJoinMsgRef: string | null = null;
	private baseUrl: string;
	private apiKey: string;
	private userId: string;
	private vaultId: string | null;
	private deviceId: string | null;
	/** Current connection id, minted fresh per physical socket. */
	private connId: string | null = null;
	/** Opt-in gate for the `crdt:` topic. When false the channel never joins the
	 *  CRDT topic and behaves exactly like a non-CRDT build (legacy path only). */
	private readonly enableCrdt: boolean;
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
	/** A room became active on the server for `docId` (announced via
	 *  `broadcast_from!`, so only OTHER devices see it). Trigger a sync-step-1
	 *  for this doc so a device that doesn't yet have the note pulls it. */
	onCrdtDocReady: ((docId: string) => void) | null = null;
	/** Fired when the `crdt:` topic join is acknowledged by the server.
	 *  Use this to activate CRDT routing in the SyncEngine — only wire
	 *  `setCrdtManager` after this fires, so the legacy pushNote path stays
	 *  active against non-CRDT backends (which reply with a join error and
	 *  never fire this callback). */
	onCrdtJoined: (() => void) | null = null;
	/** Fired when the `crdt:` topic join (or REJOIN) is rejected by the server.
	 *  `reason` is the `response.reason` string from the server payload (undefined
	 *  if absent). `min` is the server's minimum supported proto version, present
	 *  only when `reason === "crdt_proto_too_old"`.
	 *
	 *  In main.ts, wire this to reset `crdtEverJoined = false` and call
	 *  `setCrdtManager(null)` so that a failed rejoin (e.g. backend downgrade or
	 *  transient error after a previously successful join) degrades to the legacy
	 *  pushNote path rather than silently dropping edits into a dead transport. */
	onCrdtJoinError: ((reason: string | undefined, min?: number) => void) | null = null;

	constructor(
		baseUrl: string,
		apiKey: string,
		userId: string,
		vaultId: string | null = null,
		enableCrdt = false,
		deviceId: string | null = null,
	) {
		this.baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/api$/, "");
		this.apiKey = apiKey;
		this.userId = userId;
		this.vaultId = vaultId;
		this.enableCrdt = enableCrdt;
		this.deviceId = deviceId;
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
		deviceId: string | null = this.deviceId,
	): void {
		this.baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/api$/, "");
		this.apiKey = apiKey;
		this.userId = userId;
		this.vaultId = vaultId;
		this.deviceId = deviceId;
		// A backend/vault switch invalidates the window the old server advertised;
		// the next sync join reply re-populates it (or the default floor applies).
		this.reconnectJitterMaxMs = null;
	}

	private get topic(): string {
		return this.vaultId ? `sync:${this.userId}:${this.vaultId}` : `sync:${this.userId}`;
	}

	private get userTopic(): string {
		return `user:${this.userId}`;
	}

	private get crdtTopic(): string | null {
		// Gated on the opt-in flag: when CRDT is disabled the topic is null, so the
		// channel never joins `crdt:`, never sends frames, and never surfaces an
		// onCrdtJoined — identical to a non-CRDT build.
		if (!this.enableCrdt) return null;
		return this.vaultId ? `crdt:${this.userId}:${this.vaultId}` : null;
	}

	/** Send a CRDT update frame to the server on the crdt topic.
	 *  No-op when vaultId is null (crdt topic not joined). */
	sendCrdt(docId: string, b64: string): void {
		const t = this.crdtTopic;
		if (!t) return;
		// join_ref MUST be the crdt: topic's join_ref. Phoenix routes channel
		// messages by (topic, join_ref); sending null here means the server can't
		// match the joined channel and silently drops the frame (every CRDT update
		// vanished before reaching the backend).
		this.send([this.crdtJoinRef, String(++this.ref), t, "crdt_msg", { doc_id: docId, b64 }]);
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
		// Always reset crdtJoined on intentional disconnect regardless of whether
		// the sync topic was also joined (setConnected only resets it on transition).
		this.crdtJoined = false;
		this.setConnected(false);
		this.connId = null;
		rlog().setConnId(null);
		// Drop the cached server window so a later connect to a different backend
		// that advertises none falls back to the default floor, not a stale value.
		this.reconnectJitterMaxMs = null;
		rlog().info("channel", "Channel disconnected");
	}

	isConnected(): boolean {
		return this.connected;
	}

	/** True only when the `crdt:` topic join has been acknowledged by the server.
	 *  The SyncEngine uses this to decide whether to route markdown saves through
	 *  CrdtManager.applyLocalEdit (CRDT path) or the legacy pushNote POST. */
	isCrdtConnected(): boolean {
		return this.crdtJoined;
	}

	/** Server-advertised full-jitter reconnect window (ms), or null until the
	 *  sync join reply has been received. Exposed for tests. */
	getReconnectJitterMaxMs(): number | null {
		return this.reconnectJitterMaxMs;
	}

	/** Current connection id (fresh per physical socket). Exposed for tests. */
	getConnId(): string | null {
		return this.connId;
	}

	// ---------------------------------------------------------------------------
	// Private
	// ---------------------------------------------------------------------------

	/** Guards openSocket against re-entry across its async token fetch. */
	private opening = false;

	private async openSocket(): Promise<void> {
		// Single-flight: if a socket already exists (an external connect() won
		// the race against a still-pending reconnect timer) or another
		// openSocket is suspended on the token fetch, bail. A second live
		// socket fights over this.ws/connected — the orphan's onclose clobbers
		// the current connection's state, leaving a zombie channel that
		// reports connected while the server holds no subscription.
		if (this.ws || this.opening) {
			rlog().info("channel", "openSocket skipped — socket already present or opening");
			return;
		}
		this.opening = true;
		try {
			await this.openSocketInner();
		} finally {
			this.opening = false;
		}
	}

	private async openSocketInner(): Promise<void> {
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

		this.connId = crypto.randomUUID();
		rlog().setConnId(this.connId);

		const wsBase = this.baseUrl.replace(/^http/, "ws").replace(/^https/, "wss");
		const params = new URLSearchParams({
			token,
			vsn: "2.0.0",
			conn_id: this.connId,
		});
		if (this.deviceId) params.set("device_id", this.deviceId);
		if (this.vaultId) params.set("vault_id", this.vaultId);
		const url = `${wsBase}/socket/websocket?${params.toString()}`;

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
			// Clear any pending heartbeat from a previous connection so the first
			// tick of the new connection doesn't incorrectly detect a timeout.
			this.pendingHeartbeatRef = null;
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

		this.ws.onclose = (evt?: CloseEvent) => {
			this.clearTimers();
			this.ws = null;
			this.setConnected(false);

			// Real browsers always pass a CloseEvent here; some lightweight test
			// doubles call onclose with no argument. Fall back to "unknown" rather
			// than crash so this stays observability-only. `code=1009` is the
			// signal that matters: Bandit's transport killed the whole socket
			// because a frame exceeded max_frame_size (see LARGE_FRAME_WARN_BYTES
			// above and docs/context/ws-zombie-channel-diagnosis.md).
			const closeInfo = `code=${evt?.code ?? "unknown"} reason="${evt?.reason ?? ""}" wasClean=${evt?.wasClean ?? "unknown"}`;

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
					`WS closed before open at ${sinceOpen}ms — assuming stale access token, invalidating - ${closeInfo}`,
				);
				this.authProvider.invalidateAccessToken();
			}

			if (opened) {
				// A live connection dropped (graceful drain or a mid-session network
				// drop). Full-jitter the FIRST reconnect across random(0, window) so a
				// drained fleet doesn't stampede the freshly-booted node. If THIS
				// attempt also fails (close before open), the next onclose has
				// opened=false and falls through to exponential backoff below.
				// NOTE: local name is `jitterWindow`, not `window` — `window` is the
				// global used for setTimeout just below.
				const jitterWindow = this.reconnectJitterMaxMs ?? RECONNECT_JITTER_DEFAULT_MS;
				const delay = fullJitterDelay(jitterWindow);
				rlog().info(
					"channel",
					`Channel dropped after live connection — jittered reconnect in ${Math.round(delay)}ms (window ${jitterWindow}ms) - ${closeInfo}`,
				);
				this.reconnectTimer = window.setTimeout(() => void this.openSocket(), delay);
			} else {
				rlog().info(
					"channel",
					`Channel closed, reconnecting in ${this.reconnectMs}ms - ${closeInfo}`,
				);
				this.scheduleReconnect();
			}
		};
	}

	private joinChannel(): void {
		// Reset crdtJoinMsgRef on every (re)connect so a new join issues a fresh ref.
		this.crdtJoinMsgRef = null;
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
			const msgRef = String(++this.ref);
			// Capture the join ref so handleMessage can distinguish a join-error reply
			// (this ref) from per-message error replies (a different ref) — see crdtJoinMsgRef.
			this.crdtJoinMsgRef = msgRef;
			this.send([this.crdtJoinRef, msgRef, crdtT, "phx_join", { crdt_proto: 2 }]);
		}
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = window.setInterval(() => this.heartbeatTick(), 30_000);
	}

	/** Interval body for the heartbeat. Extracted so tests can drive it directly
	 *  without fake timers. Called once per 30s interval while the socket is open.
	 *
	 *  If `pendingHeartbeatRef` is still set from the previous tick the server never
	 *  replied — the socket is half-dead (classic mobile app-resume state). Force
	 *  close so the existing onclose → scheduleReconnect machinery can recover.
	 *  Otherwise stamp a new pending ref and send the heartbeat frame. */
	private heartbeatTick(): void {
		if (this.ws?.readyState !== WebSocket.OPEN) return;
		if (this.pendingHeartbeatRef !== null) {
			rlog().warn("channel", "heartbeat unanswered — closing dead socket");
			this.ws?.close();
			return;
		}
		this.pendingHeartbeatRef = String(++this.ref);
		this.send([null, this.pendingHeartbeatRef, "phoenix", "heartbeat", {}]);
	}

	private handleMessage(raw: string): void {
		let msg: unknown[];
		try {
			msg = JSON.parse(raw) as unknown[];
		} catch {
			rlog().error("channel", `Failed to parse message: ${raw}`);
			return;
		}

		const [, ref, topic, event, payload] = msg as [
			string | null,
			string | null,
			string,
			string,
			Record<string, unknown>,
		];

		if (event === "phx_reply") {
			// Clear the outstanding heartbeat ref when the phoenix topic replies.
			// We clear on any phoenix phx_reply rather than matching the exact ref
			// because the topic is unambiguous — only heartbeats produce phoenix
			// phx_reply frames, and a reply to any heartbeat proves the socket is
			// alive regardless of which specific tick it answered.
			if (topic === "phoenix") {
				this.pendingHeartbeatRef = null;
				return;
			}
			const status = (payload as { status?: string }).status;
			if (status === "ok") {
				// The plugin's connected state is keyed ONLY on the sync topic.
				// The user topic is best-effort and must never flip connected.
				if (topic === this.topic) {
					const response = (
						payload as { response?: { reconnect_jitter_max_ms?: unknown } }
					).response;
					const clamped = clampReconnectJitter(response?.reconnect_jitter_max_ms);
					if (clamped !== null) this.reconnectJitterMaxMs = clamped;
					if (!this.connected) {
						this.setConnected(true);
						rlog().info("channel", `Joined ${this.topic}`);
					}
				} else if (topic === this.userTopic) {
					const response = (payload as { response?: { plan?: unknown } }).response;
					const plan = response?.plan;
					if (plan !== undefined && plan !== null) {
						rlog().info("channel", `Joined ${this.userTopic} — plan state received`);
						this.onPlanState?.(plan);
					}
				} else if (topic === this.crdtTopic && !this.crdtJoined) {
					// The crdt: topic join succeeded — the backend is CRDT-capable.
					// Activate CRDT routing in the SyncEngine via the onCrdtJoined
					// callback. Until this fires, all markdown saves use the legacy
					// pushNote path (graceful degradation against pre-CRDT backends).
					this.crdtJoined = true;
					rlog().info("channel", `Joined ${topic} — CRDT routing active`);
					this.onCrdtJoined?.();
				}
			} else if (status === "error") {
				// Include the topic so a best-effort user-topic join failure
				// (e.g. an older backend) is distinguishable from a sync failure.
				// Either way we do NOT touch sync connection state here.
				// A crdt: topic join error means this backend does not support CRDT —
				// crdtJoined stays false and the legacy pushNote path remains active.
				rlog().error(
					"channel",
					`Channel join error on ${topic}: ${JSON.stringify(payload)}`,
				);
				if (topic === this.crdtTopic) {
					const response = (payload as { response?: { reason?: unknown; min?: unknown } })
						.response;
					const reason =
						typeof response?.reason === "string" ? response.reason : undefined;
					const min = typeof response?.min === "number" ? response.min : undefined;
					if (ref === this.crdtJoinMsgRef) {
						// Fire onCrdtJoinError so main.ts can degrade to legacy if CRDT
						// routing was previously active (the T4 folded finding: a REJOIN
						// error while crdtEverJoined=true would otherwise leave routing
						// active on a dead transport — every md edit silently dropped).
						this.onCrdtJoinError?.(reason, min);
					} else {
						// Per-message error reply (e.g. "rate_limited" or "frame_too_large"
						// from backend #846 crdt_msg handling). These are transient and must
						// NOT tear down the CRDT session — log for visibility and continue.
						rlog().warn(
							"channel",
							`crdt: per-message error (ref=${ref ?? "null"}, reason=${reason ?? "unknown"}) — session intact`,
						);
					}
				}
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

		if (event === "crdt_doc_ready" && payload) {
			const docId = payload.doc_id as string | undefined;
			if (docId) {
				this.onCrdtDocReady?.(docId);
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
			const frame = JSON.stringify(msg);
			// Observability only - never skip or alter the send itself. Only warn
			// above the threshold so heartbeats and small CRDT deltas don't flood
			// the log; this is meant to catch the rare oversize frame before the
			// transport kills the whole socket with a 1009 close.
			if (frame.length > LARGE_FRAME_WARN_BYTES) {
				const eventType = typeof msg[3] === "string" ? msg[3] : "unknown";
				rlog().warn(
					"channel",
					`Outbound frame oversized - event=${eventType} bytes=${frame.length} approaching transport max_frame_size limit (risk of 1009 socket kill)`,
				);
			}
			this.ws.send(frame);
		}
	}

	private setConnected(value: boolean): void {
		if (this.connected !== value) {
			this.connected = value;
			if (!value) {
				// Reset the CRDT join state on disconnect so we don't hold the
				// CRDT-active signal across a reconnect. The crdt: topic join will
				// fire again if the new backend also supports CRDT; until then
				// the legacy pushNote path takes over.
				this.crdtJoined = false;
			}
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
		// Reset the pending heartbeat so a reconnect's first tick doesn't
		// misfire a stale-ref close.
		this.pendingHeartbeatRef = null;
	}

	private scheduleReconnect(overrideMs?: number): void {
		// Replace, never stack: an orphaned earlier timer would double-fire
		// openSocket (see the single-flight guard there).
		if (this.reconnectTimer) {
			window.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
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

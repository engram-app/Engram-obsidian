import type { AuthProvider } from "./auth";
import { errMsg } from "./error-util";
import { rlog } from "./remote-log";

/** How long to wait before reconnecting when no auth token is available
 *  (e.g. plugin loaded before OAuth refresh hydrated, or user signed out).
 *  Long enough to avoid console spam, short enough that re-auth catches up
 *  within a reasonable user-perceived window. */
const NO_AUTH_RECONNECT_MS = 30_000;

/** If a WS close lands within this window after open, the close is AMBIGUOUS:
 *  Phoenix's UserSocket returns 403 at upgrade for expired/invalid JWTs
 *  (manifesting client-side as an immediate close with no HTTP status), but a
 *  plain network/DNS blip produces the identical bare close before onopen.
 *  We no longer guess which one happened. Instead, within this window and
 *  while online, we fire an authenticated probe (see `setAuthProbe`) and let
 *  the api client be the sole invalidation authority. Wider than any
 *  legitimate network blip, narrower than a real session.
 */
const AUTH_FAIL_WINDOW_MS = 5_000;

/** After a mobile foreground resume, how long to wait for the resume liveness
 *  probe to be answered before declaring the socket dead. A live connection just
 *  answers (at most one extra heartbeat); a socket the OS killed during suspend
 *  never replies, so we close and reconnect in seconds instead of waiting for the
 *  next 30s heartbeat tick. */
const RESUME_PROBE_MS = 5_000;

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

/** Floor for the reconnect backoff that follows a crdt: join rejected with an
 *  explicit "rate_limited" reason (see `joinFailureBackoffMs` below) — the
 *  server told us to slow down, so the first backed-off reconnect jumps
 *  straight to this floor instead of the generic 1s start. */
export const RATE_LIMITED_JOIN_FLOOR_MS = 10_000;

/** Delay before the next connectChannel() preflight retry: exponential from
 *  2s, capped at 60s, retried indefinitely. A finite attempt cap here left
 *  live sync permanently dead after any backend outage longer than ~30s
 *  (getMe() preflight exhausted → no reconnect until plugin reload), while
 *  REST recovered on its own. */
export function connectRetryDelayMs(attempt: number, baseMs = 2000): number {
	return Math.min(baseMs * 2 ** attempt, RECONNECT_JITTER_MAX_MS);
}

export function clampReconnectJitter(raw: unknown): number | null {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
	return Math.min(raw, RECONNECT_JITTER_MAX_MS);
}

export function fullJitterDelay(windowMs: number, rng: () => number = Math.random): number {
	return rng() * windowMs;
}

/** Whether the channel's frozen topic userId no longer matches the currently-
 *  authenticated identity, so a reconnect must re-derive it before rejoining.
 *  On an OAuth rebind BACK to a prior identity (A -> B -> A) the email-based
 *  channelConnectionKey coincides, so setupNoteStream REUSES the live channel and
 *  swaps its auth provider without re-deriving `this.userId`; the next reconnect
 *  would rejoin `crdt:<staleUserId>:<vaultId>` while the socket authenticates as
 *  the current user, and the backend rejects it "unauthorized" (e2e-clerk
 *  test_84). Ids are case-sensitive UUIDs, so this does NOT fold case (unlike the
 *  email-based channelIdentityMatches). An absent authenticated id means getMe()
 *  could not verify, so treat as not-stale (no worse than before). Pure so the
 *  decision is unit-testable without a live socket. */
export function topicUserIdIsStale(
	currentUserId: string,
	authenticatedUserId: string | undefined | null,
): boolean {
	if (!authenticatedUserId) return false;
	return currentUserId !== authenticatedUserId;
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
	/**
	 * Reason from the most recent crdt: join REJECTION in the session that just
	 * ended (null if that session's crdt join succeeded, was never attempted, or
	 * hasn't replied yet). A rejected crdt join does not by itself force a
	 * reconnect — the sync topic can still be healthy — but if the WHOLE socket
	 * then closes (e.g. a server-side abuse defense, or any other drop), the
	 * next reconnect should back off rather than retry on the flat graceful-drop
	 * jitter: retrying immediately just re-triggers the same rejection before
	 * the backend's rate-limit bucket drains, producing a tight open/reject/
	 * close loop (the prod alert-noise "CRDT channel-join retry loop" — one
	 * user's plugin looping join -> rate_limited -> immediate retry for
	 * ~15 min windows). Reset to null on every joinChannel() (fresh join,
	 * fresh chance) and set only by a
	 * genuine join-ref-matching error reply — a per-message crdt_msg error
	 * (different ref) must NOT set this.
	 */
	private crdtJoinFailedReason: string | null = null;
	/** Backoff (ms) for the reconnect that follows a join-class failure. Distinct
	 *  from `reconnectMs` (which only grows on the "closed before ever opening"
	 *  path) because `reconnectMs` resets to 1000 on every successful open —
	 *  and a join-class failure by definition happens AFTER a successful open.
	 *  Reset to 1000 whenever a crdt: join succeeds (health restored). */
	private joinFailureBackoffMs = 1000;
	/** True once the socket has opened at least once this channel's lifetime. Gates
	 *  the reconnect-only identity re-derivation (see openSocketInner): a fresh
	 *  build already carries the correct userId from connectChannel's getMe(), so
	 *  only RE-opens need re-verification. */
	private hasOpened = false;
	/** Set when the auth provider is swapped on a KEPT channel (an OAuth rebind
	 *  that setupNoteStream reused rather than rebuilt). Signals that `this.userId`
	 *  may be stale relative to the new identity, so the next reconnect must
	 *  re-derive it from getMe() before rejoining `crdt:` (else the join is
	 *  refused "unauthorized", e2e-clerk test_84). Cleared once verified. */
	private identityMaybeStale = false;
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
	/** Authenticated probe injected via `setAuthProbe` (e.g. GET /me). Fired on
	 *  a fast pre-open close instead of guessing the token is stale. */
	private authProbe: (() => Promise<unknown>) | null = null;

	onEvent: ((event: NoteStreamEvent) => void) | null = null;
	onStatusChange: ((connected: boolean) => void) | null = null;
	onVaultDeleted: (() => void) | null = null;
	/** Folder markers changed on the server (create/delete/move from the web
	 *  app). Payload is advisory only — the handler re-polls /folders/explicit. */
	onFoldersChanged: (() => void) | null = null;
	/** Surfaces the user's current plan/entitlements from the best-effort
	 *  `user:{userId}` topic (join reply `response.plan` + `subscription_activated`
	 *  broadcasts). Never gates the plugin's connected state. */
	onPlanState: ((plan: unknown) => void) | null = null;
	/** Inbound CRDT frames from the server. `docId` is the note's bare note_id. */
	onCrdtMessage: ((docId: string, b64: string) => void) | null = null;
	/** A room became active on the server for `docId` (announced via
	 *  `broadcast_from!`, so only OTHER devices see it). Trigger a sync-step-1
	 *  for this doc so a device that doesn't yet have the note pulls it. */
	onCrdtDocReady: ((docId: string) => void) | null = null;
	/** A crdt_msg we sent was dropped server-side: the note_id has no row
	 *  (backend #955 error reply). The create-race cross-wire signature — wire
	 *  to the sync engine's live id-map reconcile (ensureNoteIdMapped). */
	onCrdtNoteNotFound: ((docId: string) => void) | null = null;
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
	/** Server-pushed Yjs update for a note, fanned out over the per-vault
	 *  `sync:{userId}:{vaultId}` topic regardless of CRDT-room enrollment
	 *  (backend fan-out). `b64` is the raw v1 update, still base64-encoded — the
	 *  CRDT layer decodes it. `head` is the server's post-apply head marker.
	 *  Lets an IDLE note (no dedicated CRDT room) converge without ever
	 *  STEP1-enrolling. */
	onNoteYjsUpdate: ((noteId: string, b64: string, head: string) => void) | null = null;

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
		// A provider swap on a kept channel may mean the identity changed (an OAuth
		// rebind setupNoteStream reused instead of rebuilt). Mark the frozen userId
		// as possibly stale so the next reconnect re-derives it before rejoining
		// crdt:. A fresh build clears this on its first open.
		this.identityMaybeStale = true;
		rlog().info("channel", `setAuthProvider — type=${provider.constructor.name}`);
	}

	/** Inject an authenticated probe (e.g. GET /me). On a fast pre-open close the
	 *  channel fires this instead of guessing the token is stale; the api client
	 *  is the single invalidation authority (a real 401 there invalidates and
	 *  refreshes). */
	setAuthProbe(probe: () => Promise<unknown>): void {
		this.authProbe = probe;
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

	/** Send a CRDT update frame on the crdt topic.
	 *  Returns false without sending until the crdt: join is server-acked —
	 *  a frame with a stale/absent join_ref is silently dropped server-side
	 *  (the plugin #179 failure shape), so refusing locally is the honest signal. */
	sendCrdt(docId: string, b64: string): boolean {
		const t = this.crdtTopic;
		if (!t || !this.crdtJoined) {
			// A refused frame is a lost STEP1/update from the caller's view — say
			// so, or a not-yet-joined window reads as a mystery deaf note later.
			rlog().warn(
				"channel",
				`sendCrdt refused (crdt topic not joined): doc=${docId} joined=${this.crdtJoined}`,
			);
			return false;
		}
		// join_ref MUST be the crdt: topic's join_ref. Phoenix routes channel
		// messages by (topic, join_ref); sending null here means the server can't
		// match the joined channel and silently drops the frame (every CRDT update
		// vanished before reaching the backend).
		this.send([this.crdtJoinRef, String(++this.ref), t, "crdt_msg", { doc_id: docId, b64 }]);
		return true;
	}

	async connect(): Promise<void> {
		if (this.ws) return;
		this.reconnectMs = 1000;
		this.joinFailureBackoffMs = 1000;
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
		this.crdtJoinFailedReason = null;
		this.joinFailureBackoffMs = 1000;
		rlog().info("channel", "Channel disconnected");
	}

	/** Call when the app returns to the foreground (mobile resume). Mobile OSes
	 *  suspend the socket while backgrounded; readyState can still report OPEN on a
	 *  connection that is actually dead. Rather than wait up to 30s for the next
	 *  heartbeat tick, probe liveness now and pull any pending reconnect forward so
	 *  the first post-unlock interaction is snappy.
	 *
	 *  - OPEN socket: run a heartbeat tick immediately (closes at once if the
	 *    pre-suspend heartbeat was never answered), then a fast follow-up tick so a
	 *    socket that died silently during suspend is caught in ~RESUME_PROBE_MS.
	 *  - Down with a reconnect pending: bring it forward.
	 *  - Connecting, or intentionally disconnected: nothing to do. */
	onResume(): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.heartbeatTick();
			// Reuses the heartbeat machinery: an unanswered probe closes on this tick.
			// Not tracked in clearTimers: a stray fire after disconnect is a guarded
			// no-op (heartbeatTick bails when the socket is not OPEN).
			window.setTimeout(() => this.heartbeatTick(), RESUME_PROBE_MS);
			return;
		}
		if (!this.ws && this.reconnectTimer !== null) {
			window.clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
			void this.openSocket();
		}
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

		// Reconnect-only identity guard (e2e-clerk test_84). A rebind BACK to a prior
		// identity reuses this channel (the email-based channelConnectionKey coincides)
		// and swaps its auth provider without re-deriving `this.userId`. Left as-is the
		// reconnect below would rejoin crdt:<staleUserId>:<vaultId> while the socket
		// authenticates as the current user, and the backend rejects it "unauthorized"
		// with no client-visible retry. Re-derive the id from the same getMe() the
		// build path uses and self-heal the topic before rejoining. Only on a RE-open
		// after a provider swap: a fresh build already carries the correct id, and a
		// plain network blip did not change identity. A probe failure (offline) or a
		// missing id leaves the id untouched, no worse than before.
		if (this.hasOpened && this.identityMaybeStale && this.authProbe) {
			this.identityMaybeStale = false;
			try {
				const me = (await this.authProbe()) as { id?: string } | null;
				const freshId = me?.id;
				if (freshId && topicUserIdIsStale(this.userId, freshId)) {
					rlog().warn(
						"channel",
						`reconnect identity refresh: topic userId ${this.userId} -> ${freshId} (provider swapped on a reused channel); rejoining under the authenticated id`,
					);
					this.userId = freshId;
				}
			} catch (e) {
				rlog().info(
					"channel",
					`reconnect identity probe failed, keeping userId: ${errMsg(e)}`,
				);
			}
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
			this.hasOpened = true;
			// Identity verified for this socket (fresh build carried the correct id;
			// a swapped reconnect just re-derived it above). Clear so a later network
			// blip doesn't pay for a needless getMe.
			this.identityMaybeStale = false;
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
			// crdtJoined must not survive the socket: if the crdt: ack landed but
			// the sync-topic ack never did, `connected` is still false and
			// setConnected(false) is a transition-gated no-op — leaving a stale
			// crdtJoined that lets sendCrdt bypass the join-ack contract on the
			// next socket and skips re-firing onCrdtJoined (#191).
			this.crdtJoined = false;
			this.setConnected(false);

			// Real browsers always pass a CloseEvent here; some lightweight test
			// doubles call onclose with no argument. Fall back to "unknown" rather
			// than crash so this stays observability-only. `code=1009` is the
			// signal that matters: Bandit's transport killed the whole socket
			// because a frame exceeded max_frame_size (see LARGE_FRAME_WARN_BYTES
			// above and docs/context/ws-zombie-channel-diagnosis.md).
			const closeInfo = `code=${evt?.code ?? "unknown"} reason="${evt?.reason ?? ""}" wasClean=${evt?.wasClean ?? "unknown"}`;
			const sinceOpen = Date.now() - openedAt;
			const online = typeof navigator !== "undefined" ? navigator.onLine : true;
			rlog().info(
				"channel",
				`WS closed, ${closeInfo} opened=${opened} sinceOpen=${sinceOpen}ms online=${online}`,
			);

			// A fast pre-open close is AMBIGUOUS: a server auth-reject and a network
			// drop both surface as a bare close before onopen. Do NOT guess it is a
			// stale token. If we are plainly offline, it is a network drop: keep the
			// token, back off. If online, ask the server via an authenticated probe
			// and let api.ts decide (its real-401 handler invalidates and refreshes;
			// a 2xx proves the token is fine).
			if (!opened && sinceOpen < AUTH_FAIL_WINDOW_MS && online && this.authProbe) {
				// Fire-and-forget: we want only the probe's side effect (a real 401 is
				// handled by the api client's invalidation path). Do NOT await: awaiting
				// here would defer scheduleReconnect past a suspension point and let a
				// concurrent disconnect() fail to cancel the reconnect (zombie socket).
				// A network error just means we are offline; either way the reconnect
				// below refreshes the token if needed.
				void this.authProbe().catch(() => {});
			}

			if (opened && this.crdtJoinFailedReason !== null) {
				// Join-class failure: the crdt: topic join was REJECTED in the
				// session that just ended (e.g. "rate_limited"). Retrying on the flat
				// graceful-drop jitter below just re-triggers the same rejection
				// before the backend's limiter bucket drains — a server that closes
				// the socket right after rejecting the join produces a tight
				// open/reject/close loop (the alert-noise CRDT-join burst). Back off
				// exponentially instead, capped at maxReconnectMs; an explicit
				// "rate_limited" reason gets a higher floor since the server
				// explicitly asked us to slow down.
				const floor =
					this.crdtJoinFailedReason === "rate_limited"
						? RATE_LIMITED_JOIN_FLOOR_MS
						: 1000;
				this.joinFailureBackoffMs = Math.min(
					Math.max(this.joinFailureBackoffMs * 2, floor),
					this.maxReconnectMs,
				);
				const delay =
					this.joinFailureBackoffMs + Math.random() * this.joinFailureBackoffMs * 0.5;
				rlog().info(
					"channel",
					`crdt: join rejected (${this.crdtJoinFailedReason}) — backing off reconnect ${Math.round(delay)}ms - ${closeInfo}`,
				);
				this.reconnectTimer = window.setTimeout(() => void this.openSocket(), delay);
			} else if (opened) {
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
		// Fresh join, fresh chance: this session hasn't failed (yet).
		this.crdtJoinFailedReason = null;
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
					// NOTE: the backend now ACKs every routed crdt_msg with an ok reply
					// (2026-07-14), so "ok on this topic while !crdtJoined" is no longer
					// unambiguously the join ack. The only aliasing window is an
					// in-flight message ack landing between disconnect()'s crdtJoined
					// reset and the socket actually closing; a spurious flip there is
					// undone by the onclose crdtJoined reset (#191), so ref-matching
					// would be gold-plating. sendCrdt refuses while !crdtJoined, so no
					// message acks exist before the true join ack on a fresh socket.
					// The crdt: topic join succeeded — the backend is CRDT-capable.
					// Activate CRDT routing in the SyncEngine via the onCrdtJoined
					// callback. Until this fires, all markdown saves use the legacy
					// pushNote path (graceful degradation against pre-CRDT backends).
					this.crdtJoined = true;
					// Health restored: forget any backoff built up by prior rejections.
					this.joinFailureBackoffMs = 1000;
					rlog().info("channel", `Joined ${topic} — CRDT routing active`);
					this.onCrdtJoined?.();
				}
			} else if (status === "error") {
				// A dropped crdt_msg for an unknown note_id (backend #955): the
				// sender must heal its id map NOW — the create-race cross-wire
				// signature. Not a join failure; handle before join-error logging.
				const response = (payload as { response?: { reason?: string; doc_id?: string } })
					.response;
				if (
					topic === this.crdtTopic &&
					response?.reason === "note_not_found" &&
					response.doc_id
				) {
					rlog().warn(
						"channel",
						`crdt_msg dropped by server (note_not_found): ${response.doc_id} — triggering id-map reconcile`,
					);
					this.onCrdtNoteNotFound?.(response.doc_id);
					return;
				}
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
						// Remember the rejection for THIS session so a subsequent whole-
						// socket close backs off instead of retrying on the flat jitter —
						// see joinFailureBackoffMs/crdtJoinFailedReason JSDoc above.
						this.crdtJoinFailedReason = reason ?? "unknown";
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

		if (event === "folders.batch") {
			rlog().info("channel", "Folder markers changed on server");
			this.onFoldersChanged?.();
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

		if (event === "note_yjs_update" && payload) {
			const noteId = payload.note_id as string | undefined;
			const b64 = payload.b64 as string | undefined;
			const head = payload.head as string | undefined;
			if (noteId && b64 && head) {
				this.onNoteYjsUpdate?.(noteId, b64, head);
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
				id: p.id as string | undefined,
				device_id: p.device_id as string | undefined,
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
					id: n.id as string | undefined,
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

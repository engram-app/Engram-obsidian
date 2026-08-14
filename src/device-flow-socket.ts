import { devLog } from "./dev-log";
import { errMsg } from "./error-util";

/** Phoenix drops idle sockets at ~60s; a device code lives for 300s. Without
 *  a heartbeat the listener dies partway through and the user silently falls
 *  back to the slow poll. */
const HEARTBEAT_MS = 30_000;

interface Options {
	/** Override for tests. Production always wants HEARTBEAT_MS. */
	heartbeatMs?: number;
	/** Called with true once the topic is actually joined, false on any
	 *  failure. Surfaced in the modal so "is the live path working?" is a
	 *  thing you can SEE, rather than something inferred from how long the
	 *  flow took. */
	onStatus?: (live: boolean) => void;
}

/**
 * Wait for the browser half of the device flow to authorize this code, and
 * call `onAuthorized` the moment it does.
 *
 * Replaces a 5s polling loop. The plugin holds no token yet — obtaining one
 * IS this flow — so it cannot use the authenticated socket in `channel.ts`.
 * This rides `/socket/device`, which is unauthenticated by necessity and
 * gates authorization per-topic on the `device_code` instead.
 *
 * What arrives is a NOTIFICATION, never credentials: a broadcast reaches
 * every subscriber at once whereas the token exchange is single-use, so
 * shipping tokens here would be weaker than the REST endpoint it front-runs.
 * The caller reacts by performing exactly one exchange.
 *
 * Best-effort by design. Every failure path is silent-and-harmless because
 * the caller keeps a slow REST poll running underneath for networks that
 * block WebSockets — this makes the common case instant, it is not a
 * correctness dependency.
 *
 * Speaks the Phoenix v2 wire protocol directly (`[join_ref, ref, topic,
 * event, payload]`), same as `channel.ts`, so no phoenix npm dependency.
 *
 * @returns a disposer. After calling it, `onAuthorized` will not fire.
 */
export function waitForDeviceAuthorization(
	apiUrl: string,
	deviceCode: string,
	onAuthorized: () => void,
	opts: Options = {},
): () => void {
	const topic = `device:${deviceCode}`;
	let socket: WebSocket | null = null;
	let heartbeat: number | null = null;
	let disposed = false;
	let ref = 0;

	const dispose = (): void => {
		disposed = true;
		if (heartbeat !== null) {
			window.clearInterval(heartbeat);
			heartbeat = null;
		}
		try {
			socket?.close();
		} catch {
			// Already closing/closed — nothing to salvage.
		}
		socket = null;
	};

	try {
		// The socket lives at the ORIGIN, not under /api — apiUrl is normalized
		// to end in /api, so strip it the way channel.ts does for its own base.
		const wsBase = apiUrl.replace(/\/api\/?$/, "").replace(/^http/, "ws");
		socket = new WebSocket(`${wsBase}/socket/device/websocket?vsn=2.0.0`);
	} catch (e) {
		// WebSockets blocked outright. The fallback poll carries the flow.
		devLog().log("device-flow", `socket construct failed: ${errMsg(e)}`);
		opts.onStatus?.(false);
		return dispose;
	}

	const send = (frame: unknown[]): void => {
		try {
			socket?.send(JSON.stringify(frame));
		} catch (e) {
			devLog().log("device-flow", `socket send failed: ${errMsg(e)}`);
		}
	};

	socket.onopen = () => {
		if (disposed) {
			return;
		}
		send(["1", String(++ref), topic, "phx_join", {}]);
		heartbeat = window.setInterval(() => {
			// join_ref is null for the phoenix control topic.
			send([null, String(++ref), "phoenix", "heartbeat", {}]);
		}, opts.heartbeatMs ?? HEARTBEAT_MS);
	};

	socket.onmessage = (evt: MessageEvent) => {
		if (disposed) {
			return;
		}
		try {
			const frame = JSON.parse(String(evt.data)) as unknown[];
			// Match the topic explicitly. One socket only ever joins one device
			// topic, but a stray frame must never be read as our authorization.
			if (frame[2] === topic && frame[3] === "authorized") {
				onAuthorized();
				return;
			}
			// The join reply is the only proof the live path actually works —
			// the socket opening says nothing, because a channel whose join
			// crashes server-side still gets you a happily OPEN socket first.
			if (frame[2] === topic && frame[3] === "phx_reply") {
				const ok = (frame[4] as { status?: string } | undefined)?.status === "ok";
				devLog().log("device-flow", `join reply status=${ok ? "ok" : "error"}`);
				opts.onStatus?.(ok);
			}
		} catch (e) {
			devLog().log("device-flow", `socket frame parse failed: ${errMsg(e)}`);
		}
	};

	socket.onerror = () => {
		// Not fatal: the poll is still running. But the user should be told
		// which path they are on.
		devLog().log("device-flow", "socket error — falling back to poll");
		opts.onStatus?.(false);
	};

	socket.onclose = (evt: CloseEvent) => {
		if (disposed) {
			return;
		}
		devLog().log("device-flow", `socket closed code=${evt.code} — falling back to poll`);
		opts.onStatus?.(false);
	};

	return dispose;
}

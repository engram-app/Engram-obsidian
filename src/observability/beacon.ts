// Fire-and-forget beacon post. Never blocks or fails a note push. Uses fetch
// directly (not the retrying api client) because a dropped beacon is fine.
export type BeaconEntry = {
	trace_id: string;
	parent_span_id: string;
	name: string;
	start_us: number;
	end_us: number;
	attributes: Record<string, string>;
};

// Coalescing buffer: enqueue is O(1) and never touches the network. Spans
// flush as one batch on a ~2s timer, at the endpoint's 20-span cap, or on
// unload. This keeps "enabled" cost to one batched request per burst (not
// per push) and stays under the backend 60/min rate limit. All network is
// fire-and-forget with keepalive so it never blocks or fails a note push.
export type BeaconTransport = { baseUrl: string; token: string; vaultId: string; deviceId: string };

const FLUSH_MS = 2000;
const MAX_BATCH = 20;

export class BeaconBuffer {
	private queue: BeaconEntry[] = [];
	// window.setTimeout/clearTimeout (not the bare globals) for popout-window
	// compatibility, per obsidianmd/prefer-window-timers.
	private timer: number | null = null;
	constructor(private transport: () => BeaconTransport | null) {}

	enqueue(entry: BeaconEntry): void {
		this.queue.push(entry);
		if (this.queue.length >= MAX_BATCH) {
			this.flush();
		} else if (this.timer === null) {
			this.timer = window.setTimeout(() => this.flush(), FLUSH_MS);
		}
	}

	flush(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.queue.length === 0) return;
		const batch = this.queue.splice(0, this.queue.length);
		const t = this.transport();
		if (!t) return; // disabled or not ready: drop, never block
		try {
			// window.fetch (not requestUrl): this is the one network call in the
			// plugin that needs `keepalive`, so an in-flight beacon still lands
			// after plugin unload. requestUrl has no such guarantee. Fire-and-forget:
			// never awaited, never surfaced to the caller.
			void window
				.fetch(`${t.baseUrl}/api/telemetry/spans`, {
					method: "POST",
					keepalive: true,
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${t.token}`,
						"X-Vault-ID": t.vaultId,
						"X-Device-Id": t.deviceId,
					},
					body: JSON.stringify({ spans: batch }),
				})
				.catch(() => {});
		} catch {
			// never surface
		}
	}
}

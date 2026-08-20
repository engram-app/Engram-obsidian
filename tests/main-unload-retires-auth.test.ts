/**
 * Tests: onunload (main.ts) retires the auth provider (#420).
 *
 * A plugin update/reload replaces the whole plugin instance. If the outgoing
 * instance's OAuthAuth is left undisposed, a refresh in flight at unload time
 * resolves afterward, persists over the NEW instance's data.json, and forks
 * the rotating refresh-token chain — the server's reuse detection then
 * revokes the whole token family (prod incident 2026-08-12).
 *
 * Isolated in its own file: onunload tears down module-level loggers
 * (destroyDevLog / setLogSink), which would pollute sibling tests.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import { OAuthAuth } from "../src/auth";
import EngramSyncPlugin from "../src/main";

// DEV_MODE is an esbuild-injected define; bun test loads sources directly.
(globalThis as unknown as { DEV_MODE?: boolean }).DEV_MODE ??= false;

describe("onunload auth-provider retirement", () => {
	const order: string[] = [];

	test("disposes the OAuthAuth so a post-unload refresh cannot persist", () => {
		order.length = 0;
		const old = new OAuthAuth("engram_rt_old", "vault-1", "u@test.com", mock());
		const disposeSpy = spyOn(old, "dispose");
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			authProvider: old,
			crdtWiring: null,
			api: { beacon: { flush() {} } },
			syncEngine: {
				getLastSync() {
					return 0;
				},
				destroy() {},
			},
			async savePluginData(_ls: unknown) {},
			baseStore: null,
			crdtOpQueue: null,
			noteStream: { disconnect: () => order.push("disconnect") },
			crdtLiveViews: null,
			crdtManager: null,
			syncInterval: null,
			promiseTracker: null,
			// onunload publishes any final staged claim and detaches the index
			// room's listeners (#362). Modelled on the double rather than made
			// optional in production — both fields always exist on a real plugin.
			noteIdMap: { flushNow: () => order.push("flush") },
			indexRoom: { destroy: () => {} },
		});

		EngramSyncPlugin.prototype.onunload.call(fake as never);

		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});

	// The index flush has to run BEFORE the socket goes, which is what its
	// comment claims. It used to run after `disconnect()`, so the frame was
	// refused, buffered, and then discarded with the provider: the id survived
	// in data.json but the vault was never told. Round 4 found the ordering
	// untested (flushNow was stubbed to a no-op).
	test("flushes staged index claims BEFORE disconnecting the socket", () => {
		order.length = 0;
		const old = new OAuthAuth("engram_rt_old", "vault-1", "u@test.com", mock());
		spyOn(old, "dispose");
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			authProvider: old,
			crdtWiring: null,
			api: { beacon: { flush() {} } },
			syncEngine: {
				getLastSync() {
					return 0;
				},
				destroy() {},
			},
			async savePluginData(_ls: unknown) {},
			baseStore: null,
			crdtOpQueue: null,
			noteStream: { disconnect: () => order.push("disconnect") },
			crdtLiveViews: null,
			crdtManager: null,
			syncInterval: null,
			promiseTracker: null,
			noteIdMap: { flushNow: () => order.push("flush") },
			indexRoom: { destroy: () => order.push("destroy") },
		});

		EngramSyncPlugin.prototype.onunload.call(fake as never);

		expect(order.indexOf("flush")).toBeGreaterThanOrEqual(0);
		expect(order.indexOf("flush")).toBeLessThan(order.indexOf("disconnect"));
	});
});
